import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import type { Ora } from "ora";
import { simpleGit } from "simple-git";
import { create as createTar } from "tar";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  getRepositories,
  type ProjectConfig,
  projectConfigExists,
  type Repository,
  readProjectConfig,
} from "../lib/config.js";
import {
  getSigningKeyPaths,
  signingKeysExist,
  signPackage,
} from "../lib/signing.js";
import { checksumFile } from "../utils/checksum.js";
import { formatRepo, logger, spinner } from "../utils/logger.js";

// Regex for parsing submodule status (moved to top level for performance)
const SUBMODULE_STATUS_PATTERN = /^[\s-+]?([a-f0-9]+)\s+(\S+)/;

interface PackOptions {
  images: boolean;
  key?: string;
  name?: string;
  output: string;
  sign?: boolean;
  sources: boolean;
}

interface DockerImage {
  name: string;
  size: number;
}

interface RepoInfo {
  branch?: string;
  commit: string;
  commit_date: string;
  name: string;
  submodules: Array<{ path: string; commit: string }>;
  url: string;
}

interface Manifest {
  checksums: Record<string, string>;
  docker: {
    images: DockerImage[];
    total_size: number;
  };
  package: {
    name: string;
    created: string;
    created_by: string;
  };
  project: ProjectConfig["project"];
  repositories: RepoInfo[];
  vendor: ProjectConfig["vendor"];
  version: string;
}

interface ComposeService {
  build?: string | object;
  image?: string;
  restart?: string;
  [key: string]: unknown;
}

interface ComposeFile {
  networks?: Record<string, unknown>;
  services?: Record<string, ComposeService>;
  version?: string;
  volumes?: Record<string, unknown>;
}

interface OfflineCompose {
  networks?: Record<string, unknown>;
  services: Record<string, ComposeService>;
  version: string;
  volumes?: Record<string, unknown>;
}

export const packCommand = new Command("pack")
  .description("Create offline package for deployment")
  .option("-o, --output <path>", "Output directory", "./releases")
  .option("-n, --name <name>", "Package name (default: from project config)")
  .option("--no-sources", "Exclude git bundles (images only)")
  .option("--no-images", "Exclude Docker images (sources only)")
  .option("-s, --sign", "Sign the package after creation")
  .option("-k, --key <path>", "Path to private key for signing")
  .action(async (options: PackOptions) => {
    if (!projectConfigExists()) {
      logger.error("Project not initialized. Run 'cin init' first.");
      process.exit(1);
    }

    const config = readProjectConfig();
    if (!config) {
      logger.error("Project not initialized. Run 'cin init' first.");
      process.exit(1);
    }

    const repos = getRepositories();

    if (repos.length === 0) {
      logger.error("No repositories configured. Add one with 'cin repo add'.");
      process.exit(1);
    }

    const reposDir = join(process.cwd(), ".cin", "repos");

    // Check all repos are cloned
    for (const repo of repos) {
      if (!existsSync(join(reposDir, repo.name))) {
        logger.error(
          `Repository '${repo.name}' not cloned. Run 'cin pull' first.`
        );
        process.exit(1);
      }
    }

    await createPackage(config, repos, reposDir, options);
  });

async function createPackage(
  config: ProjectConfig,
  repos: Repository[],
  reposDir: string,
  options: PackOptions
): Promise<void> {
  const projectName = config.project?.name ?? "project";
  const date = new Date().toISOString().split("T")[0];
  const packageName = options.name ?? `${projectName}-${date}`;
  const outputDir = options.output;

  // Create staging directory
  const stagingDir = join(process.cwd(), ".cin", "staging", packageName);
  if (existsSync(stagingDir)) {
    rmSync(stagingDir, { recursive: true });
  }
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(join(stagingDir, "sources"), { recursive: true });
  mkdirSync(join(stagingDir, "docker"), { recursive: true });

  const manifest: Manifest = {
    version: "1.0",
    package: {
      name: packageName,
      created: new Date().toISOString(),
      created_by: "cin-cli@0.1.0",
    },
    project: config.project,
    vendor: config.vendor,
    repositories: [],
    docker: {
      images: [],
      total_size: 0,
    },
    checksums: {},
  };

  // Process repositories
  for (const repo of repos) {
    const repoPath = join(reposDir, repo.name);

    // Create git bundle
    if (options.sources) {
      await createGitBundle(repo, repoPath, stagingDir);
    }

    // Get repo info for manifest
    const repoInfo = await getRepoInfo(repo, repoPath);
    manifest.repositories.push(repoInfo);
  }

  // Export Docker images
  if (options.images) {
    await exportDockerImages(repos, reposDir, stagingDir, manifest);
  }

  // Generate offline docker-compose.yml
  generateOfflineCompose(repos, reposDir, stagingDir, manifest);

  // Calculate checksums
  await calculateChecksums(stagingDir, manifest);

  // Write manifest
  const manifestPath = join(stagingDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Create archive
  mkdirSync(outputDir, { recursive: true });
  const archivePath = join(outputDir, `${packageName}.tar.gz`);

  const spin = spinner("Creating archive...").start();
  try {
    await createTar(
      {
        gzip: true,
        file: archivePath,
        cwd: join(stagingDir, ".."),
      },
      [packageName]
    );

    const archiveSize = statSync(archivePath).size;
    spin.succeed(`Package created: ${archivePath}`);
    logger.info(`  Size: ${formatSize(archiveSize)}`);
    logger.info(`  Repositories: ${manifest.repositories.length}`);
    logger.info(`  Docker images: ${manifest.docker.images.length}`);

    // Calculate archive checksum
    const archiveChecksum = await checksumFile(archivePath);
    const shortHash = archiveChecksum.replace("sha256:", "").substring(0, 16);
    logger.info(`  SHA256: ${shortHash}...`);

    // Sign package if requested
    if (options.sign) {
      signCreatedPackage(archivePath, options.key);
    }
  } catch (error) {
    spin.fail(`Failed to create archive: ${(error as Error).message}`);
    process.exit(1);
  } finally {
    // Cleanup staging directory
    rmSync(stagingDir, { recursive: true });
  }
}

function signCreatedPackage(archivePath: string, keyPath?: string): void {
  let privateKeyPath = keyPath;

  if (!privateKeyPath) {
    const { privateKeyPath: defaultPath } = getSigningKeyPaths();
    if (!signingKeysExist()) {
      logger.warn("No signing key found, skipping signature");
      logger.info("Generate keys with: cin key generate");
      return;
    }
    privateKeyPath = defaultPath;
  }

  if (!existsSync(privateKeyPath)) {
    logger.warn(`Signing key not found: ${privateKeyPath}`);
    return;
  }

  const spin = spinner("Signing package...").start();

  try {
    const signatureInfo = signPackage(archivePath, privateKeyPath);
    spin.succeed("Package signed");
    logger.info(`  Key ID: ${signatureInfo.keyId}`);
    logger.info(`  Signature: ${archivePath}.sig`);
  } catch (error) {
    spin.fail(`Failed to sign package: ${(error as Error).message}`);
  }
}

async function createGitBundle(
  repo: Repository,
  repoPath: string,
  stagingDir: string
): Promise<void> {
  const spin = spinner(
    `Creating bundle for ${formatRepo(repo.name)}...`
  ).start();

  try {
    const git = simpleGit(repoPath);
    const bundlePath = join(stagingDir, "sources", `${repo.name}.bundle`);

    // Create bundle with all refs
    await git.raw(["bundle", "create", bundlePath, "--all"]);
    spin.succeed(`Bundle created: ${repo.name}.bundle`);

    // Handle submodules
    if (repo.submodules !== undefined) {
      await bundleSubmodules(repo, repoPath, stagingDir, spin);
    }
  } catch (error) {
    spin.fail(
      `Failed to create bundle for ${repo.name}: ${(error as Error).message}`
    );
  }
}

async function bundleSubmodules(
  repo: Repository,
  repoPath: string,
  stagingDir: string,
  spin: Ora
): Promise<void> {
  const git = simpleGit(repoPath);

  try {
    const submoduleStatus = await git.subModule(["status"]);
    if (!submoduleStatus.trim()) {
      return;
    }

    const submodulesDir = join(stagingDir, "sources", repo.name);
    mkdirSync(submodulesDir, { recursive: true });

    const lines = submoduleStatus.trim().split("\n");
    for (const line of lines) {
      const match = line.match(SUBMODULE_STATUS_PATTERN);
      if (!match) {
        continue;
      }

      const submodulePath = match[2];
      const submoduleFullPath = join(repoPath, submodulePath);
      const bundleName = `${submodulePath.replace(/\//g, "-")}.bundle`;
      const bundlePath = join(submodulesDir, bundleName);

      if (existsSync(submoduleFullPath)) {
        const subGit = simpleGit(submoduleFullPath);
        await subGit.raw(["bundle", "create", bundlePath, "--all"]);
        spin.text = `Bundled submodule: ${submodulePath}`;
      }
    }
  } catch {
    // Submodules are optional, continue on error
    logger.warn(`Warning: Could not bundle submodules for ${repo.name}`);
  }
}

async function getRepoInfo(
  repo: Repository,
  repoPath: string
): Promise<RepoInfo> {
  const git = simpleGit(repoPath);
  const log = await git.log({ n: 1 });
  const commit = log.latest;

  const info: RepoInfo = {
    name: repo.name,
    url: repo.url,
    branch: repo.branch,
    commit: commit?.hash ?? "unknown",
    commit_date: commit?.date ?? new Date().toISOString(),
    submodules: [],
  };

  // Get submodule info
  if (repo.submodules !== undefined) {
    try {
      const submoduleStatus = await git.subModule(["status"]);
      if (submoduleStatus.trim()) {
        const lines = submoduleStatus.trim().split("\n");
        for (const line of lines) {
          const match = line.match(SUBMODULE_STATUS_PATTERN);
          if (match) {
            info.submodules.push({
              path: match[2],
              commit: match[1],
            });
          }
        }
      }
    } catch {
      // Ignore submodule errors
    }
  }

  return info;
}

function collectDockerImages(
  repos: Repository[],
  reposDir: string
): Set<string> {
  const images = new Set<string>();

  for (const repo of repos) {
    const repoPath = join(reposDir, repo.name);
    const composePath = join(repoPath, "docker-compose.yml");

    if (!existsSync(composePath)) {
      continue;
    }

    const composeContent = readFileSync(composePath, "utf-8");
    const compose = parseYaml(composeContent) as ComposeFile;

    if (compose.services) {
      for (const [serviceName, service] of Object.entries(compose.services)) {
        if (service.image) {
          images.add(service.image);
        } else if (service.build) {
          images.add(`${repo.name}-${serviceName}:latest`);
        }
      }
    }
  }

  return images;
}

async function getImageSize(image: string): Promise<number> {
  try {
    const output = await runCommand("docker", [
      "inspect",
      "--format",
      "{{.Size}}",
      image,
    ]);
    return Number.parseInt(output.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function exportDockerImages(
  repos: Repository[],
  reposDir: string,
  stagingDir: string,
  manifest: Manifest
): Promise<void> {
  const spin = spinner("Collecting Docker images...").start();

  const images = collectDockerImages(repos, reposDir);

  if (images.size === 0) {
    spin.warn("No Docker images found");
    return;
  }

  spin.text = `Exporting ${images.size} Docker image(s)...`;

  const imagesPath = join(stagingDir, "docker", "images.tar");
  const imageList = Array.from(images);

  try {
    await runCommand("docker", ["save", "-o", imagesPath, ...imageList]);

    manifest.docker.total_size = statSync(imagesPath).size;

    for (const image of imageList) {
      const size = await getImageSize(image);
      manifest.docker.images.push({ name: image, size });
    }

    spin.succeed(`Exported ${images.size} Docker image(s)`);
  } catch (error) {
    spin.fail(`Failed to export images: ${(error as Error).message}`);
    logger.info("Make sure all images are built with 'cin build'");
  }
}

function convertServiceForOffline(
  service: ComposeService,
  repoName: string,
  serviceName: string
): ComposeService {
  const { build: _build, ...rest } = service;
  const offlineService: ComposeService = { ...rest };

  if (_build) {
    offlineService.image = `${repoName}-${serviceName}:latest`;
  }

  if (!offlineService.restart) {
    offlineService.restart = "unless-stopped";
  }

  return offlineService;
}

function processRepoCompose(
  repo: Repository,
  reposDir: string,
  offlineCompose: OfflineCompose
): void {
  const repoPath = join(reposDir, repo.name);
  const composePath = join(repoPath, "docker-compose.yml");

  if (!existsSync(composePath)) {
    return;
  }

  const composeContent = readFileSync(composePath, "utf-8");
  const compose = parseYaml(composeContent) as ComposeFile;

  if (compose.services) {
    for (const [serviceName, service] of Object.entries(compose.services)) {
      const key = `${repo.name}_${serviceName}`;
      offlineCompose.services[key] = convertServiceForOffline(
        service,
        repo.name,
        serviceName
      );
    }
  }

  if (compose.volumes) {
    offlineCompose.volumes = { ...offlineCompose.volumes, ...compose.volumes };
  }

  if (compose.networks) {
    offlineCompose.networks = {
      ...offlineCompose.networks,
      ...compose.networks,
    };
  }
}

function generateOfflineCompose(
  repos: Repository[],
  reposDir: string,
  stagingDir: string,
  manifest: Manifest
): void {
  const spin = spinner("Generating offline compose file...").start();

  const offlineCompose: OfflineCompose = {
    version: "3.8",
    services: {},
    volumes: {},
    networks: {},
  };

  for (const repo of repos) {
    processRepoCompose(repo, reposDir, offlineCompose);
  }

  // Clean up empty sections
  if (Object.keys(offlineCompose.volumes ?? {}).length === 0) {
    offlineCompose.volumes = undefined;
  }
  if (Object.keys(offlineCompose.networks ?? {}).length === 0) {
    offlineCompose.networks = undefined;
  }

  const composeOutput = `# Generated by CIN CLI
# Package: ${manifest.package.name}
# Created: ${manifest.package.created}
# DO NOT EDIT - This file is auto-generated for offline deployment

${stringifyYaml(offlineCompose)}`;

  const composePath = join(stagingDir, "docker", "docker-compose.yml");
  writeFileSync(composePath, composeOutput);

  spin.succeed("Generated offline docker-compose.yml");
}

async function calculateChecksums(
  stagingDir: string,
  manifest: Manifest
): Promise<void> {
  const spin = spinner("Calculating checksums...").start();

  const files = getAllFiles(stagingDir);

  for (const file of files) {
    const relativePath = file.replace(`${stagingDir}/`, "");
    if (relativePath === "manifest.json") {
      continue;
    }
    manifest.checksums[relativePath] = await checksumFile(file);
  }

  const checksumCount = Object.keys(manifest.checksums).length;
  spin.succeed(`Calculated ${checksumCount} checksum(s)`);
}

function getAllFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      getAllFiles(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `Exit code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
