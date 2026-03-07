import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { extract as extractTar } from "tar";
import { checksumFile } from "../utils/checksum.js";
import { formatPath, formatVersion, logger, spinner } from "../utils/logger.js";

// Default rollback settings
const DEFAULT_ROLLBACK_CONFIG = {
  max_versions: 3,
  backup_volumes: false,
  auto_cleanup: true,
};

export const deployCommand = new Command("deploy")
  .description("Deploy offline package to target directory")
  .argument("<package>", "Path to package file (.tar.gz)")
  .option("-t, --target <path>", "Target directory", "/opt/app")
  .option("--no-start", "Do not start services after deployment")
  .option("--no-backup", "Do not create backup of current version")
  .option("--no-verify", "Skip checksum verification")
  .action(async (packagePath, options) => {
    if (!existsSync(packagePath)) {
      logger.error(`Package not found: ${packagePath}`);
      process.exit(1);
    }

    await deployPackage(packagePath, options);
  });

/**
 * Deploy the package
 */
async function deployPackage(packagePath, options) {
  const targetDir = resolve(options.target);

  // Extract to temp directory first
  const tempDir = join(targetDir, ".cin", "temp");
  mkdirSync(tempDir, { recursive: true });

  const spin = spinner("Extracting package...").start();

  try {
    await extractTar({ file: packagePath, cwd: tempDir });
    spin.succeed("Package extracted");
  } catch (error) {
    spin.fail(`Failed to extract package: ${error.message}`);
    process.exit(1);
  }

  // Find the extracted directory (should be single directory)
  const extracted = readdirSync(tempDir);
  if (extracted.length !== 1) {
    logger.error("Invalid package structure");
    rmSync(tempDir, { recursive: true });
    process.exit(1);
  }

  const packageDir = join(tempDir, extracted[0]);
  const manifestPath = join(packageDir, "manifest.json");

  if (!existsSync(manifestPath)) {
    logger.error("Package missing manifest.json");
    rmSync(tempDir, { recursive: true });
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const packageName = manifest.package?.name || "unknown";

  logger.info(`Package: ${packageName}`);
  logger.info(`Created: ${manifest.package?.created || "unknown"}`);

  // Verify checksums
  if (options.verify) {
    const verified = await verifyChecksums(packageDir, manifest);
    if (!verified) {
      rmSync(tempDir, { recursive: true });
      process.exit(1);
    }
  }

  // Check if already deployed
  const stateFile = join(targetDir, ".cin", "state.json");
  const currentState = existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, "utf-8"))
    : null;

  if (currentState?.current_version === packageName) {
    logger.skip(`Already deployed: ${packageName}`);
    rmSync(tempDir, { recursive: true });
    return;
  }

  // Create backup if needed
  if (options.backup && currentState) {
    await createBackup(targetDir, currentState);
  }

  // Load Docker images
  const imagesPath = join(packageDir, "docker", "images.tar");
  if (existsSync(imagesPath)) {
    await loadDockerImages(imagesPath);
  }

  // Deploy to target
  await deployToTarget(packageDir, targetDir);

  // Update state
  updateState(targetDir, manifest);

  // Cleanup old versions
  const rollbackConfig = loadRollbackConfig(targetDir);
  if (rollbackConfig.auto_cleanup) {
    cleanupOldVersions(targetDir, rollbackConfig.max_versions);
  }

  // Start services
  if (options.start) {
    await startServices(targetDir);
  }

  // Cleanup temp
  rmSync(tempDir, { recursive: true });

  logger.success(`Deployment complete: ${formatVersion(packageName)}`);

  const currentDir = join(targetDir, "current");
  logger.info(`  Location: ${formatPath(currentDir)}`);

  if (!options.start) {
    logger.info("  Services not started (--no-start)");
    logger.info(`  Start with: cd ${currentDir} && docker compose up -d`);
  }
}

/**
 * Verify package checksums
 */
async function verifyChecksums(packageDir, manifest) {
  const spin = spinner("Verifying checksums...").start();

  const checksums = manifest.checksums || {};
  let valid = true;
  let checked = 0;

  for (const [relativePath, expectedChecksum] of Object.entries(checksums)) {
    const filePath = join(packageDir, relativePath);

    if (!existsSync(filePath)) {
      spin.fail(`Missing file: ${relativePath}`);
      valid = false;
      continue;
    }

    const actualChecksum = await checksumFile(filePath);
    if (actualChecksum !== expectedChecksum) {
      spin.fail(`Checksum mismatch: ${relativePath}`);
      valid = false;
    }
    checked++;
  }

  if (valid) {
    spin.succeed(`Verified ${checked} file(s)`);
  }

  return valid;
}

/**
 * Create backup of current version
 */
function createBackup(targetDir, currentState) {
  const spin = spinner("Creating backup...").start();

  const currentDir = join(targetDir, "current");
  if (!existsSync(currentDir)) {
    spin.warn("No current version to backup");
    return;
  }

  const versionName = currentState.current_version || "unknown";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `${versionName}_${timestamp}`;
  const versionsDir = join(targetDir, "versions");
  const backupDir = join(versionsDir, backupName);

  mkdirSync(backupDir, { recursive: true });

  // Copy current deployment
  cpSync(currentDir, backupDir, { recursive: true });

  // Save manifest if exists
  if (currentState.manifest) {
    writeFileSync(
      join(backupDir, "manifest.json"),
      JSON.stringify(currentState.manifest, null, 2)
    );
  }

  spin.succeed(`Backup created: ${backupName}`);
}

/**
 * Load Docker images
 */
async function loadDockerImages(imagesPath) {
  const spin = spinner("Loading Docker images...").start();

  try {
    const size = statSync(imagesPath).size;
    spin.text = `Loading Docker images (${formatSize(size)})...`;

    await runCommand("docker", ["load", "-i", imagesPath]);
    spin.succeed("Docker images loaded");
  } catch (error) {
    spin.fail(`Failed to load images: ${error.message}`);
    throw error;
  }
}

/**
 * Deploy files to target directory
 */
async function deployToTarget(packageDir, targetDir) {
  const spin = spinner("Deploying...").start();

  const currentDir = join(targetDir, "current");

  // Stop existing services if running
  if (existsSync(currentDir)) {
    spin.text = "Stopping existing services...";
    try {
      await runCommand("docker", ["compose", "down"], { cwd: currentDir });
    } catch {
      // Ignore errors, services might not be running
    }

    // Remove old current directory
    rmSync(currentDir, { recursive: true });
  }

  // Create new current directory
  mkdirSync(currentDir, { recursive: true });

  // Copy docker-compose.yml
  const composeSrc = join(packageDir, "docker", "docker-compose.yml");
  if (existsSync(composeSrc)) {
    cpSync(composeSrc, join(currentDir, "docker-compose.yml"));
  }

  // Copy sources if present (for reference/debugging)
  const sourcesSrc = join(packageDir, "sources");
  if (existsSync(sourcesSrc)) {
    cpSync(sourcesSrc, join(currentDir, "sources"), { recursive: true });
  }

  // Copy manifest
  cpSync(join(packageDir, "manifest.json"), join(currentDir, "manifest.json"));

  spin.succeed("Files deployed");
}

/**
 * Update deployment state
 */
function updateState(targetDir, manifest) {
  const cinDir = join(targetDir, ".cin");
  mkdirSync(cinDir, { recursive: true });

  const state = {
    current_version: manifest.package?.name || "unknown",
    deployed_at: new Date().toISOString(),
    manifest,
  };

  writeFileSync(join(cinDir, "state.json"), JSON.stringify(state, null, 2));
}

/**
 * Load rollback configuration
 */
function loadRollbackConfig(targetDir) {
  const configPath = join(targetDir, ".cin", "rollback.yaml");

  if (!existsSync(configPath)) {
    return { ...DEFAULT_ROLLBACK_CONFIG };
  }

  try {
    const { parse } = require("yaml");
    const content = readFileSync(configPath, "utf-8");
    return { ...DEFAULT_ROLLBACK_CONFIG, ...parse(content) };
  } catch {
    return { ...DEFAULT_ROLLBACK_CONFIG };
  }
}

/**
 * Cleanup old versions
 */
function cleanupOldVersions(targetDir, maxVersions) {
  const versionsDir = join(targetDir, "versions");

  if (!existsSync(versionsDir)) {
    return;
  }

  const versions = readdirSync(versionsDir)
    .map((name) => ({
      name,
      path: join(versionsDir, name),
      stat: statSync(join(versionsDir, name)),
    }))
    .filter((v) => v.stat.isDirectory())
    .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

  if (versions.length <= maxVersions) {
    return;
  }

  const toDelete = versions.slice(maxVersions);
  for (const version of toDelete) {
    rmSync(version.path, { recursive: true });
    logger.info(`Cleaned up old version: ${version.name}`);
  }
}

/**
 * Start services
 */
async function startServices(targetDir) {
  const spin = spinner("Starting services...").start();

  const currentDir = join(targetDir, "current");
  const composePath = join(currentDir, "docker-compose.yml");

  if (!existsSync(composePath)) {
    spin.warn("No docker-compose.yml found");
    return;
  }

  try {
    await runCommand("docker", ["compose", "up", "-d"], { cwd: currentDir });
    spin.succeed("Services started");

    // Show running services
    const output = await runCommand(
      "docker",
      ["compose", "ps", "--format", "table"],
      {
        cwd: currentDir,
      }
    );
    console.log(`\n${output}`);
  } catch (error) {
    spin.fail(`Failed to start services: ${error.message}`);
  }
}

/**
 * Run a command
 */
function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

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
 * Format file size
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
