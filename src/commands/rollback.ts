import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { formatVersion, logger, spinner } from "../utils/logger.js";

interface RollbackOptions {
  list?: boolean;
  start: boolean;
  target: string;
  to?: string;
}

interface Version {
  mtime: Date;
  name: string;
  path: string;
}

interface Manifest {
  package?: {
    created?: string;
  };
}

interface DeployState {
  current_version: string;
  deployed_at: string;
  manifest?: Manifest;
  rolled_back_from?: string;
}

export const rollbackCommand = new Command("rollback")
  .description("Rollback to a previous version")
  .option("-t, --target <path>", "Target directory", "/opt/app")
  .option("-l, --list", "List available versions")
  .option("--to <version>", "Rollback to specific version")
  .option("--no-start", "Do not start services after rollback")
  .action(async (options: RollbackOptions) => {
    const targetDir = resolve(options.target);

    if (!existsSync(targetDir)) {
      logger.error(`Target directory not found: ${targetDir}`);
      process.exit(1);
    }

    if (options.list) {
      listVersions(targetDir);
      return;
    }

    await performRollback(targetDir, options);
  });

function listVersions(targetDir: string): void {
  const versionsDir = join(targetDir, "versions");
  const stateFile = join(targetDir, ".cin", "state.json");

  // Get current version
  let currentVersion: string | null = null;
  if (existsSync(stateFile)) {
    const state: DeployState = JSON.parse(readFileSync(stateFile, "utf-8"));
    currentVersion = state.current_version;
  }

  console.log(chalk.bold("\n=== Available Versions ===\n"));

  if (currentVersion) {
    console.log(
      `  ${chalk.green("*")} ${chalk.cyan(currentVersion)} ${chalk.gray("(current)")}`
    );
  }

  if (!existsSync(versionsDir)) {
    console.log(chalk.gray("\n  No backup versions available"));
    console.log();
    return;
  }

  const versions = getVersionsList(versionsDir);

  if (versions.length === 0) {
    console.log(chalk.gray("\n  No backup versions available"));
    console.log();
    return;
  }

  console.log();
  for (const version of versions) {
    const date = version.mtime.toISOString().replace("T", " ").substring(0, 19);
    console.log(`    ${chalk.yellow(version.name)}`);
    console.log(`      Created: ${chalk.gray(date)}`);

    // Show manifest info if available
    const manifestPath = join(version.path, "manifest.json");
    if (existsSync(manifestPath)) {
      const manifest: Manifest = JSON.parse(
        readFileSync(manifestPath, "utf-8")
      );
      if (manifest.package?.created) {
        console.log(`      Package: ${chalk.gray(manifest.package.created)}`);
      }
    }
  }

  console.log();
  logger.info("Use 'cin rollback' to rollback to the most recent version");
  logger.info("Use 'cin rollback --to <version>' for a specific version");
  console.log();
}

function getVersionsList(versionsDir: string): Version[] {
  return readdirSync(versionsDir)
    .map((name) => {
      const versionPath = join(versionsDir, name);
      const stat = statSync(versionPath);
      return {
        name,
        path: versionPath,
        mtime: stat.mtime,
      };
    })
    .filter((v) => statSync(v.path).isDirectory())
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

async function performRollback(
  targetDir: string,
  options: RollbackOptions
): Promise<void> {
  const versionsDir = join(targetDir, "versions");
  const currentDir = join(targetDir, "current");
  const stateFile = join(targetDir, ".cin", "state.json");

  if (!existsSync(versionsDir)) {
    logger.error("No backup versions available");
    process.exit(1);
  }

  const versions = getVersionsList(versionsDir);

  if (versions.length === 0) {
    logger.error("No backup versions available");
    process.exit(1);
  }

  // Find version to rollback to
  let targetVersion: Version | undefined;

  if (options.to) {
    const toVersion = options.to;
    targetVersion = versions.find((v) => v.name === toVersion);
    if (!targetVersion) {
      // Try partial match
      targetVersion = versions.find((v) => v.name.startsWith(toVersion));
    }
    if (!targetVersion) {
      logger.error(`Version not found: ${toVersion}`);
      logger.info("Use 'cin rollback --list' to see available versions");
      process.exit(1);
    }
  } else {
    // Use most recent version
    targetVersion = versions[0];
  }

  // Get current state
  let currentState: DeployState | null = null;
  if (existsSync(stateFile)) {
    currentState = JSON.parse(readFileSync(stateFile, "utf-8"));
  }

  // Check if rolling back to same version
  if (
    currentState?.current_version === extractVersionName(targetVersion.name)
  ) {
    logger.skip(`Already at version: ${targetVersion.name}`);
    return;
  }

  logger.info(`Rolling back to: ${formatVersion(targetVersion.name)}`);

  // Stop current services
  if (existsSync(currentDir)) {
    await stopServices(currentDir);
  }

  // Restore version
  restoreVersion(targetVersion, currentDir);

  // Load Docker images if available
  const imagesPath = join(targetVersion.path, "images.tar");
  if (existsSync(imagesPath)) {
    await loadDockerImages(imagesPath);
  }

  // Update state
  updateState(targetDir, targetVersion);

  // Start services
  if (options.start) {
    await startServices(currentDir);
  }

  logger.success(`Rollback complete: ${formatVersion(targetVersion.name)}`);

  if (!options.start) {
    logger.info("Services not started (--no-start)");
    logger.info(`Start with: cd ${currentDir} && docker compose up -d`);
  }
}

function extractVersionName(backupName: string): string {
  // Format: versionName_timestamp
  const parts = backupName.split("_");
  if (parts.length >= 2) {
    // Remove timestamp part
    parts.pop();
    return parts.join("_");
  }
  return backupName;
}

async function stopServices(currentDir: string): Promise<void> {
  const spin = spinner("Stopping current services...").start();

  try {
    await runCommand("docker", ["compose", "down"], { cwd: currentDir });
    spin.succeed("Services stopped");
  } catch {
    spin.warn("Could not stop services (may not be running)");
  }
}

function restoreVersion(version: Version, currentDir: string): void {
  const spin = spinner("Restoring version...").start();

  try {
    // Remove current directory
    if (existsSync(currentDir)) {
      rmSync(currentDir, { recursive: true });
    }

    // Copy version to current
    cpSync(version.path, currentDir, { recursive: true });

    // Remove images.tar from current (not needed there)
    const imagesInCurrent = join(currentDir, "images.tar");
    if (existsSync(imagesInCurrent)) {
      rmSync(imagesInCurrent);
    }

    spin.succeed("Version restored");
  } catch (error) {
    spin.fail(`Failed to restore version: ${(error as Error).message}`);
    throw error;
  }
}

async function loadDockerImages(imagesPath: string): Promise<void> {
  const spin = spinner("Loading Docker images...").start();

  try {
    const size = statSync(imagesPath).size;
    spin.text = `Loading Docker images (${formatSize(size)})...`;

    await runCommand("docker", ["load", "-i", imagesPath]);
    spin.succeed("Docker images loaded");
  } catch (error) {
    spin.warn(`Could not load images: ${(error as Error).message}`);
  }
}

function updateState(targetDir: string, version: Version): void {
  const cinDir = join(targetDir, ".cin");
  const stateFile = join(cinDir, "state.json");

  // Try to read manifest from restored version
  const manifestPath = join(version.path, "manifest.json");
  let manifest: Manifest | null = null;
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  }

  const state: DeployState = {
    current_version: extractVersionName(version.name),
    deployed_at: new Date().toISOString(),
    rolled_back_from: version.name,
    manifest: manifest ?? undefined,
  };

  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

async function startServices(currentDir: string): Promise<void> {
  const spin = spinner("Starting services...").start();

  const composePath = join(currentDir, "docker-compose.yml");
  if (!existsSync(composePath)) {
    spin.warn("No docker-compose.yml found");
    return;
  }

  try {
    await runCommand("docker", ["compose", "up", "-d"], { cwd: currentDir });
    spin.succeed("Services started");

    const output = await runCommand(
      "docker",
      ["compose", "ps", "--format", "table"],
      { cwd: currentDir }
    );
    console.log(`\n${output}`);
  } catch (error) {
    spin.fail(`Failed to start services: ${(error as Error).message}`);
  }
}

interface RunOptions {
  cwd?: string;
}

function runCommand(
  cmd: string,
  args: string[],
  options: RunOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

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
