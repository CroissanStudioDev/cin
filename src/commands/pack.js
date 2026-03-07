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
import simpleGit from "simple-git";
import { create as createTar } from "tar";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  getRepositories,
  projectConfigExists,
  readProjectConfig,
} from "../lib/config.js";
import { checksumFile } from "../utils/checksum.js";
import { formatRepo, logger, spinner } from "../utils/logger.js";

// Regex for parsing submodule status (moved to top level for performance)
const SUBMODULE_STATUS_PATTERN = /^[\s-+]?([a-f0-9]+)\s+(\S+)/;

export const packCommand = new Command("pack")
  .description("Create offline package for deployment")
  .option("-o, --output <path>", "Output directory", "./releases")
  .option("-n, --name <name>", "Package name (default: from project config)")
  .option("--no-sources", "Exclude git bundles (images only)")
  .option("--no-images", "Exclude Docker images (sources only)")
  .action(async (options) => {
    if (!projectConfigExists()) {
      logger.error("Project not initialized. Run 'cin init' first.");
      process.exit(1);
    }

    const config = readProjectConfig();
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

/**
 * Create the offline package
 */
async function createPackage(config, repos, reposDir, options) {
  const projectName = config.project?.name || "project";
  const date = new Date().toISOString().split("T")[0];
  const packageName = options.name || `${projectName}-${date}`;
  const outputDir = options.output;

  // Create staging directory
  const stagingDir = join(process.cwd(), ".cin", "staging", packageName);
  if (existsSync(stagingDir)) {
    rmSync(stagingDir, { recursive: true });
  }
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(join(stagingDir, "sources"), { recursive: true });
  mkdirSync(join(stagingDir, "docker"), { recursive: true });

  const manifest = {
    version: "1.0",
    package: {
      name: packageName,
      created: new Date().toISOString(),
      created_by: "cin-cli@0.1.0",
    },
    project: config.project || {},
    vendor: config.vendor || {},
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
  await generateOfflineCompose(repos, reposDir, stagingDir, manifest);

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
  } catch (error) {
    spin.fail(`Failed to create archive: ${error.message}`);
    process.exit(1);
  } finally {
    // Cleanup staging directory
    rmSync(stagingDir, { recursive: true });
  }
}

/**
 * Create git bundle for a repository
 */
async function createGitBundle(repo, repoPath, stagingDir) {
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
    if (repo.submodules?.enabled !== false) {
      await bundleSubmodules(repo, repoPath, stagingDir, spin);
    }
  } catch (error) {
    spin.fail(`Failed to create bundle for ${repo.name}: ${error.message}`);
  }
}

/**
 * Bundle submodules
 */
async function bundleSubmodules(repo, repoPath, stagingDir, spin) {
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

/**
 * Get repository info for manifest
 */
async function getRepoInfo(repo, repoPath) {
  const git = simpleGit(repoPath);
  const log = await git.log({ n: 1 });
  const commit = log.latest;

  const info = {
    name: repo.name,
    url: repo.url,
    branch: repo.branch,
    commit: commit?.hash || "unknown",
    commit_date: commit?.date || new Date().toISOString(),
    submodules: [],
  };

  // Get submodule info
  if (repo.submodules?.enabled !== false) {
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

/**
 * Collect Docker images from compose files
 */
function collectDockerImages(repos, reposDir) {
  const images = new Set();

  for (const repo of repos) {
    const repoPath = join(reposDir, repo.name);
    const composeFile = repo.docker?.compose_file || "docker-compose.yml";
    const composePath = join(repoPath, composeFile);

    if (!existsSync(composePath)) {
      continue;
    }

    const composeContent = readFileSync(composePath, "utf-8");
    const compose = parseYaml(composeContent);

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

/**
 * Get image size from docker inspect
 */
async function getImageSize(image) {
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

/**
 * Export Docker images
 */
async function exportDockerImages(repos, reposDir, stagingDir, manifest) {
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
    spin.fail(`Failed to export images: ${error.message}`);
    logger.info("Make sure all images are built with 'cin build'");
  }
}

/**
 * Convert a service for offline use (replace build with image)
 */
function convertServiceForOffline(service, repoName, serviceName) {
  const { build, ...rest } = service;
  const offlineService = { ...rest };

  if (build) {
    offlineService.image = `${repoName}-${serviceName}:latest`;
  }

  if (!offlineService.restart) {
    offlineService.restart = "unless-stopped";
  }

  return offlineService;
}

/**
 * Process a single repo's compose file
 */
function processRepoCompose(repo, reposDir, offlineCompose) {
  const repoPath = join(reposDir, repo.name);
  const composeFile = repo.docker?.compose_file || "docker-compose.yml";
  const composePath = join(repoPath, composeFile);

  if (!existsSync(composePath)) {
    return;
  }

  const composeContent = readFileSync(composePath, "utf-8");
  const compose = parseYaml(composeContent);

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
    Object.assign(offlineCompose.volumes, compose.volumes);
  }

  if (compose.networks) {
    Object.assign(offlineCompose.networks, compose.networks);
  }
}

/**
 * Generate offline docker-compose.yml
 */
function generateOfflineCompose(repos, reposDir, stagingDir, manifest) {
  const spin = spinner("Generating offline compose file...").start();

  const offlineCompose = {
    version: "3.8",
    services: {},
    volumes: {},
    networks: {},
  };

  for (const repo of repos) {
    processRepoCompose(repo, reposDir, offlineCompose);
  }

  // Clean up empty sections (set to undefined instead of delete)
  if (Object.keys(offlineCompose.volumes).length === 0) {
    offlineCompose.volumes = undefined;
  }
  if (Object.keys(offlineCompose.networks).length === 0) {
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

/**
 * Calculate checksums for all files
 */
async function calculateChecksums(stagingDir, manifest) {
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

/**
 * Get all files in a directory recursively
 */
function getAllFiles(dir, files = []) {
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

/**
 * Run a command and return output
 */
function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
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

/**
 * Format file size for display
 */
function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
