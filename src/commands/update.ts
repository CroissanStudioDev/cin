import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import { simpleGit } from "simple-git";
import {
  getConfigCwd,
  getRepositories,
  projectConfigExists,
  readProjectConfig,
  resolveSshKey,
} from "../lib/config.js";
import { EXIT_CODES } from "../utils/exit-codes.js";
import { formatRepo, formatVersion, logger, spinner } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

interface BackupManifest {
  checksum?: string;
  created_at: string;
  git_commits: Record<string, string>;
  has_env: boolean;
  has_volumes: boolean;
  name: string;
  version: string | null;
  volumes: string[];
}

interface UpdateOptions {
  yes?: boolean;
}

interface RollbackOptions {
  yes?: boolean;
}

interface CommandResult {
  stderr: string;
  stdout: string;
  success: boolean;
  timedOut?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const MAX_BACKUPS = 3;
const BACKUPS_DIR = "backups";
const LOCK_FILE = ".cin-update.lock";

// Timeouts (in milliseconds)
const DOCKER_COMMAND_TIMEOUT = 300_000; // 5 minutes for general commands
const DOCKER_STOP_TIMEOUT = 60; // seconds for graceful stop
const VOLUME_BACKUP_TIMEOUT = 600_000; // 10 minutes per volume

// Preferred backup image (small and commonly available)
const BACKUP_IMAGE = "busybox:latest";

// =============================================================================
// Lock Management (prevent concurrent operations)
// =============================================================================

function getLockPath(): string {
  return join(getConfigCwd(), ".cin", LOCK_FILE);
}

function acquireLock(): boolean {
  const lockPath = getLockPath();
  mkdirSync(join(getConfigCwd(), ".cin"), { recursive: true });

  if (existsSync(lockPath)) {
    const lockContent = readFileSync(lockPath, "utf-8");
    const lockTime = new Date(lockContent).getTime();
    const now = Date.now();

    // Lock expires after 30 minutes (stale lock protection)
    if (now - lockTime < 30 * 60 * 1000) {
      return false;
    }
    // Stale lock, remove it
    unlinkSync(lockPath);
  }

  writeFileSync(lockPath, new Date().toISOString());
  return true;
}

function releaseLock(): void {
  const lockPath = getLockPath();
  if (existsSync(lockPath)) {
    unlinkSync(lockPath);
  }
}

// =============================================================================
// Graceful Shutdown Handling
// =============================================================================

let cleanupCallbacks: Array<() => Promise<void>> = [];
let isShuttingDown = false;

function registerCleanup(callback: () => Promise<void>): void {
  cleanupCallbacks.push(callback);
}

function clearCleanups(): void {
  cleanupCallbacks = [];
}

async function runCleanups(): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  console.log("\n");
  logger.warn("Interrupted! Running cleanup...");

  for (const callback of cleanupCallbacks) {
    try {
      await callback();
    } catch {
      // Ignore cleanup errors
    }
  }

  releaseLock();
  process.exit(1);
}

// Register signal handlers
function handleSignal(): void {
  runCleanups().catch(() => process.exit(1));
}
process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);

// =============================================================================
// Command Execution with Timeout
// =============================================================================

function runCommand(
  cmd: string,
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<CommandResult> {
  const timeout = options.timeout ?? DOCKER_COMMAND_TIMEOUT;

  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      // Force kill after 5 seconds if still running
      setTimeout(() => proc.kill("SIGKILL"), 5000);
    }, timeout);

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({
        success: code === 0 && !timedOut,
        stdout,
        stderr,
        timedOut,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      const errorMsg = err.message.includes("ENOENT")
        ? `Command not found: ${cmd}`
        : err.message;
      resolve({
        success: false,
        stdout,
        stderr: errorMsg,
        timedOut: false,
      });
    });
  });
}

// =============================================================================
// Docker Utilities
// =============================================================================

async function checkDockerAvailable(): Promise<boolean> {
  const result = await runCommand("docker", ["info"], { timeout: 10_000 });
  return result.success;
}

async function ensureBackupImage(): Promise<boolean> {
  // Check if image exists locally
  const checkResult = await runCommand("docker", [
    "image",
    "inspect",
    BACKUP_IMAGE,
  ]);

  if (checkResult.success) {
    return true;
  }

  // Try to pull
  const pullResult = await runCommand("docker", ["pull", BACKUP_IMAGE], {
    timeout: 60_000,
  });

  return pullResult.success;
}

async function getProjectVolumes(projectName: string): Promise<string[]> {
  const result = await runCommand("docker", [
    "volume",
    "ls",
    "--format",
    "{{.Name}}",
    "--filter",
    `name=${projectName}`,
  ]);

  if (!result.success) {
    return [];
  }

  return result.stdout
    .trim()
    .split("\n")
    .filter((v) => v.length > 0);
}

async function stopServices(cwd: string): Promise<boolean> {
  const spin = spinner("Stopping services (graceful)...").start();

  // Use explicit timeout for graceful shutdown
  const result = await runCommand(
    "docker",
    ["compose", "stop", "-t", String(DOCKER_STOP_TIMEOUT)],
    { cwd, timeout: (DOCKER_STOP_TIMEOUT + 30) * 1000 }
  );

  if (result.success) {
    spin.succeed("Services stopped");
  } else if (result.timedOut) {
    spin.warn("Services stop timed out, forcing...");
    await runCommand("docker", ["compose", "kill"], { cwd });
  } else {
    spin.warn("Could not stop services (may not be running)");
  }

  return result.success;
}

async function startServices(cwd: string): Promise<boolean> {
  const spin = spinner("Starting services...").start();
  const result = await runCommand("docker", ["compose", "up", "-d"], {
    cwd,
    timeout: 120_000,
  });

  if (result.success) {
    spin.succeed("Services started");
  } else {
    spin.fail(`Failed to start services: ${result.stderr.substring(0, 100)}`);
  }

  return result.success;
}

// =============================================================================
// Volume Backup/Restore (with compression)
// =============================================================================

async function backupVolume(
  volumeName: string,
  backupDir: string
): Promise<boolean> {
  mkdirSync(join(backupDir, "volumes"), { recursive: true });

  // Use busybox with gzip compression
  const result = await runCommand(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${volumeName}:/source:ro`,
      "-v",
      `${join(backupDir, "volumes")}:/backup`,
      BACKUP_IMAGE,
      "sh",
      "-c",
      `tar -czf /backup/${volumeName}.tar.gz -C /source .`,
    ],
    { timeout: VOLUME_BACKUP_TIMEOUT }
  );

  if (result.timedOut) {
    logger.warn(`Volume backup timed out: ${volumeName}`);
  }

  return result.success;
}

async function restoreVolume(
  volumeName: string,
  backupDir: string
): Promise<boolean> {
  // Support both compressed and uncompressed backups
  const compressedPath = join(backupDir, "volumes", `${volumeName}.tar.gz`);
  const uncompressedPath = join(backupDir, "volumes", `${volumeName}.tar`);

  let backupFile: string | null = null;
  if (existsSync(compressedPath)) {
    backupFile = `${volumeName}.tar.gz`;
  } else if (existsSync(uncompressedPath)) {
    backupFile = `${volumeName}.tar`;
  }

  if (!backupFile) {
    return false;
  }

  const isCompressed = backupFile.endsWith(".gz");
  const tarFlags = isCompressed ? "-xzf" : "-xf";

  // Ensure volume exists
  await runCommand("docker", ["volume", "create", volumeName]);

  // Restore using busybox
  const result = await runCommand(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${volumeName}:/target`,
      "-v",
      `${join(backupDir, "volumes")}:/backup:ro`,
      BACKUP_IMAGE,
      "sh",
      "-c",
      `rm -rf /target/* /target/..?* /target/.[!.]* 2>/dev/null; tar ${tarFlags} /backup/${backupFile} -C /target`,
    ],
    { timeout: VOLUME_BACKUP_TIMEOUT }
  );

  return result.success;
}

// =============================================================================
// Checksum Utilities
// =============================================================================

function calculateFileChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex").substring(0, 16)));
    stream.on("error", reject);
  });
}

async function calculateBackupChecksum(backupDir: string): Promise<string> {
  const hash = createHash("sha256");
  const volumesDir = join(backupDir, "volumes");

  if (existsSync(volumesDir)) {
    const files = readdirSync(volumesDir).sort();
    for (const file of files) {
      const filePath = join(volumesDir, file);
      const fileHash = await calculateFileChecksum(filePath);
      hash.update(`${file}:${fileHash}`);
    }
  }

  const envPath = join(backupDir, ".env");
  if (existsSync(envPath)) {
    const envHash = await calculateFileChecksum(envPath);
    hash.update(`env:${envHash}`);
  }

  return hash.digest("hex").substring(0, 16);
}

// =============================================================================
// Backup Management
// =============================================================================

function buildSshCommand(sshKeyPath: string): string {
  return `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no`;
}

function getBackupsDir(): string {
  return join(getConfigCwd(), ".cin", BACKUPS_DIR);
}

async function backupGitCommits(
  repos: Array<{ name: string }>,
  reposDir: string
): Promise<Record<string, string>> {
  const commits: Record<string, string> = {};

  for (const repo of repos) {
    const repoPath = join(reposDir, repo.name);
    if (existsSync(repoPath)) {
      try {
        const git = simpleGit(repoPath);
        const commit = await git.revparse(["HEAD"]);
        commits[repo.name] = commit.trim();
      } catch {
        // Ignore
      }
    }
  }

  return commits;
}

async function backupProjectVolumes(
  projectName: string,
  backupDir: string,
  manifest: BackupManifest
): Promise<void> {
  const volumes = await getProjectVolumes(projectName);

  if (volumes.length === 0) {
    return;
  }

  const imageReady = await ensureBackupImage();
  if (!imageReady) {
    logger.warn(`Could not pull ${BACKUP_IMAGE}, volume backup may fail`);
  }

  const spin = spinner(`Backing up ${volumes.length} volume(s)...`).start();

  let backedUp = 0;
  for (const volume of volumes) {
    spin.text = `Backing up volume: ${volume}`;
    const success = await backupVolume(volume, backupDir);
    if (success) {
      manifest.volumes.push(volume);
      backedUp++;
    }
  }

  if (backedUp > 0) {
    manifest.has_volumes = true;
    spin.succeed(`Backed up ${backedUp} volume(s) (compressed)`);
  } else {
    spin.warn("No volumes backed up");
  }
}

async function createBackup(
  name: string,
  version: string | null,
  repos: Array<{ name: string; ssh_key?: string; submodules?: unknown[] }>,
  reposDir: string,
  projectDir: string
): Promise<BackupManifest | null> {
  const backupsDir = getBackupsDir();
  const backupDir = join(backupsDir, name);

  // Clean if exists
  if (existsSync(backupDir)) {
    rmSync(backupDir, { recursive: true });
  }
  mkdirSync(backupDir, { recursive: true });

  const manifest: BackupManifest = {
    name,
    version,
    created_at: new Date().toISOString(),
    git_commits: {},
    volumes: [],
    has_volumes: false,
    has_env: false,
  };

  // 1. Save git commits
  manifest.git_commits = await backupGitCommits(repos, reposDir);

  // 2. Backup .env file
  const envPath = join(projectDir, ".env");
  if (existsSync(envPath)) {
    cpSync(envPath, join(backupDir, ".env"));
    manifest.has_env = true;
  }

  // 3. Backup docker volumes
  const config = readProjectConfig();
  const projectName = config?.project?.name ?? "project";
  const composePath = join(projectDir, "docker-compose.yml");
  const hasCompose = existsSync(composePath);

  if (hasCompose) {
    registerCleanup(async () => {
      logger.info("Restarting services after interruption...");
      await startServices(projectDir);
    });
    await stopServices(projectDir);
  }

  await backupProjectVolumes(projectName, backupDir, manifest);

  if (hasCompose) {
    await startServices(projectDir);
    clearCleanups();
  }

  // 4. Calculate checksum
  manifest.checksum = await calculateBackupChecksum(backupDir);

  // 5. Save manifest
  writeFileSync(
    join(backupDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  // 6. Cleanup old backups
  cleanupOldBackups(backupsDir);

  return manifest;
}

function cleanupOldBackups(backupsDir: string): void {
  if (!existsSync(backupsDir)) {
    return;
  }

  const backups = readdirSync(backupsDir)
    .map((name) => ({
      name,
      path: join(backupsDir, name),
      stat: statSync(join(backupsDir, name)),
    }))
    .filter((b) => b.stat.isDirectory())
    .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

  if (backups.length > MAX_BACKUPS) {
    const toDelete = backups.slice(MAX_BACKUPS);
    for (const backup of toDelete) {
      rmSync(backup.path, { recursive: true });
      logger.info(`Cleaned up old backup: ${backup.name}`);
    }
  }
}

function listBackups(): BackupManifest[] {
  const backupsDir = getBackupsDir();

  if (!existsSync(backupsDir)) {
    return [];
  }

  const backups: BackupManifest[] = [];

  const dirs = readdirSync(backupsDir)
    .map((name) => ({
      name,
      path: join(backupsDir, name),
      stat: statSync(join(backupsDir, name)),
    }))
    .filter((b) => b.stat.isDirectory())
    .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

  for (const dir of dirs) {
    const manifestPath = join(dir.path, "manifest.json");
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        backups.push(manifest);
      } catch {
        // Ignore invalid manifests
      }
    }
  }

  return backups;
}

// =============================================================================
// Utility Functions
// =============================================================================

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

function getBackupSize(backupName: string): number {
  const backupDir = join(getBackupsDir(), backupName);
  if (!existsSync(backupDir)) {
    return 0;
  }

  return getDirSize(backupDir);
}

function getDirSize(dirPath: string): number {
  let totalSize = 0;

  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      totalSize += getDirSize(fullPath);
    } else if (entry.isFile()) {
      try {
        totalSize += statSync(fullPath).size;
      } catch {
        // Ignore
      }
    }
  }

  return totalSize;
}

function getRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) {
    return "just now";
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return date.toISOString().split("T")[0];
}

// =============================================================================
// Update Types
// =============================================================================

interface RepoUpdate {
  currentCommit: string;
  currentTag: string | null;
  latestCommit: string;
  latestTag: string;
  repo: { name: string; ssh_key?: string; submodules?: unknown[] };
}

// =============================================================================
// Update Helper Functions
// =============================================================================

const TIMESTAMP_REGEX = /[:.]/g;

async function checkRepoForUpdates(
  repo: { name: string; ssh_key?: string; submodules?: unknown[] },
  reposDir: string
): Promise<RepoUpdate | null> {
  const repoPath = join(reposDir, repo.name);

  if (!existsSync(repoPath)) {
    logger.skip(`${formatRepo(repo.name)}: not cloned (run 'cin pull' first)`);
    return null;
  }

  const git = simpleGit(repoPath);

  // Configure SSH
  const sshKey = repo.ssh_key ? resolveSshKey(repo.ssh_key) : null;
  if (sshKey) {
    git.env("GIT_SSH_COMMAND", buildSshCommand(sshKey));
  }

  // Fetch latest
  const fetchSpin = spinner(`Fetching ${formatRepo(repo.name)}...`).start();
  try {
    await git.fetch(["--tags", "--force"]);
    fetchSpin.stop();
  } catch (error) {
    fetchSpin.fail(`Failed to fetch: ${(error as Error).message}`);
    return null;
  }

  // Get current state
  const currentCommit = await git.revparse(["HEAD"]);
  const currentTags = await git.tag(["--points-at", "HEAD"]);
  const currentTag = currentTags.trim().split("\n")[0] || null;

  // Get latest tag
  const allTags = await git.tags(["--sort=-version:refname"]);
  const latestTag = allTags.all[0];

  if (!latestTag) {
    console.log(`  ${formatRepo(repo.name)}: no releases found`);
    return null;
  }

  // Use ^{} to dereference annotated tags to their commit SHA
  const latestCommit = await git.revparse([`${latestTag}^{}`]);

  if (currentCommit.trim() === latestCommit.trim()) {
    console.log(
      `  ${chalk.green("✓")} ${formatRepo(repo.name)}: up to date ${formatVersion(latestTag)}`
    );
    return null;
  }

  console.log(
    `  ${chalk.yellow("↑")} ${formatRepo(repo.name)}: ${formatVersion(currentTag ?? currentCommit.substring(0, 7))} → ${formatVersion(latestTag)}`
  );

  return {
    repo,
    currentTag,
    currentCommit: currentCommit.trim(),
    latestTag,
    latestCommit: latestCommit.trim(),
  };
}

async function applyRepoUpdate(
  update: RepoUpdate,
  reposDir: string
): Promise<void> {
  const repoPath = join(reposDir, update.repo.name);
  const git = simpleGit(repoPath);

  const sshKey = update.repo.ssh_key
    ? resolveSshKey(update.repo.ssh_key)
    : null;
  if (sshKey) {
    git.env("GIT_SSH_COMMAND", buildSshCommand(sshKey));
  }

  const spin = spinner(
    `Updating ${formatRepo(update.repo.name)} to ${formatVersion(update.latestTag)}...`
  ).start();

  try {
    await git.checkout([update.latestTag, "--force"]);

    if (update.repo.submodules !== undefined) {
      spin.text = "Updating submodules...";
      await git.subModule(["update", "--init", "--recursive"]);
    }

    spin.succeed(
      `${formatRepo(update.repo.name)}: updated to ${formatVersion(update.latestTag)}`
    );
  } catch (error) {
    spin.fail(`${formatRepo(update.repo.name)}: ${(error as Error).message}`);
  }
}

function printBackupInfo(manifest: BackupManifest, backupName: string): void {
  const size = getBackupSize(backupName);
  console.log();
  console.log(chalk.bold("Backup created:"));
  console.log(`  Name: ${manifest.name}`);
  console.log(`  Version: ${formatVersion(manifest.version ?? "unknown")}`);
  console.log(`  Volumes: ${manifest.volumes.length}`);
  console.log(`  .env: ${manifest.has_env ? "yes" : "no"}`);
  console.log(`  Size: ${formatSize(size)}`);
  console.log(`  Checksum: ${manifest.checksum}`);
}

// =============================================================================
// Rollback Helper Functions
// =============================================================================

function printBackupList(backups: BackupManifest[]): void {
  console.log();
  console.log(chalk.bold("Available backups:"));
  console.log();

  for (let i = 0; i < backups.length; i++) {
    const backup = backups[i];
    const size = getBackupSize(backup.name);
    const age = getRelativeTime(backup.created_at);
    const latest = i === 0 ? chalk.yellow(" (latest)") : "";

    console.log(
      `  ${chalk.cyan(i + 1)}. ${formatVersion(backup.version ?? "unknown")}${latest}`
    );
    console.log(chalk.gray(`     Created: ${age}`));
    console.log(
      chalk.gray(
        `     Volumes: ${backup.volumes.length}, .env: ${backup.has_env ? "yes" : "no"}, Size: ${formatSize(size)}`
      )
    );
    if (backup.checksum) {
      console.log(chalk.gray(`     Checksum: ${backup.checksum}`));
    }
    console.log();
  }
}

async function selectBackup(
  backups: BackupManifest[],
  skipPrompt: boolean
): Promise<number> {
  if (skipPrompt || backups.length <= 1) {
    return 0;
  }

  const { index } = await inquirer.prompt([
    {
      type: "number",
      name: "index",
      message: `Select backup to restore (1-${backups.length}):`,
      default: 1,
      validate: (val) =>
        val >= 1 && val <= backups.length ? true : "Invalid selection",
    },
  ]);
  return index - 1;
}

async function verifyBackupIntegrity(
  backup: BackupManifest,
  backupDir: string,
  skipPrompt: boolean
): Promise<boolean> {
  if (!backup.checksum) {
    return true;
  }

  const spin = spinner("Verifying backup integrity...").start();
  const currentChecksum = await calculateBackupChecksum(backupDir);

  if (currentChecksum !== backup.checksum) {
    spin.fail("Backup integrity check failed!");
    logger.error(`Expected: ${backup.checksum}, Got: ${currentChecksum}`);
    logger.warn("Backup may be corrupted. Proceed with caution.");

    if (!skipPrompt) {
      const { proceed } = await inquirer.prompt([
        {
          type: "confirm",
          name: "proceed",
          message: "Continue anyway?",
          default: false,
        },
      ]);
      return proceed;
    }
    return true;
  }

  spin.succeed("Backup integrity verified");
  return true;
}

async function confirmRollback(
  backup: BackupManifest,
  skipPrompt: boolean
): Promise<boolean> {
  if (skipPrompt) {
    return true;
  }

  console.log();
  console.log(chalk.bold("This will restore:"));
  console.log(
    `  - Git repositories to version ${formatVersion(backup.version ?? "unknown")}`
  );
  if (backup.has_volumes) {
    console.log(
      `  - ${backup.volumes.length} Docker volume(s): ${backup.volumes.join(", ")}`
    );
  }
  if (backup.has_env) {
    console.log("  - .env configuration file");
  }
  console.log();
  console.log(chalk.yellow("Warning: Current data will be overwritten!"));
  console.log();

  const { confirmed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message: "Proceed with rollback?",
      default: false,
    },
  ]);

  return confirmed;
}

async function restoreGitCommits(
  repos: Array<{ name: string; ssh_key?: string; submodules?: unknown[] }>,
  backup: BackupManifest,
  reposDir: string
): Promise<void> {
  for (const repo of repos) {
    const commit = backup.git_commits[repo.name];
    if (!commit) {
      continue;
    }

    const repoPath = join(reposDir, repo.name);
    if (!existsSync(repoPath)) {
      continue;
    }

    const git = simpleGit(repoPath);
    const sshKey = repo.ssh_key ? resolveSshKey(repo.ssh_key) : null;
    if (sshKey) {
      git.env("GIT_SSH_COMMAND", buildSshCommand(sshKey));
    }

    const spin = spinner(`Restoring ${formatRepo(repo.name)}...`).start();

    try {
      await git.checkout([commit, "--force"]);

      if (repo.submodules !== undefined) {
        await git.subModule(["update", "--init", "--recursive"]);
      }

      spin.succeed(
        `${formatRepo(repo.name)}: restored to ${commit.substring(0, 7)}`
      );
    } catch (error) {
      spin.fail(`${formatRepo(repo.name)}: ${(error as Error).message}`);
    }
  }
}

function restoreEnvFile(
  backup: BackupManifest,
  backupDir: string,
  projectDir: string
): void {
  if (!backup.has_env) {
    return;
  }

  const envBackupPath = join(backupDir, ".env");
  const envPath = join(projectDir, ".env");

  if (existsSync(envBackupPath)) {
    cpSync(envBackupPath, envPath);
    logger.success("Restored .env file");
  }
}

async function restoreVolumes(
  backup: BackupManifest,
  backupDir: string
): Promise<void> {
  if (!backup.has_volumes || backup.volumes.length === 0) {
    return;
  }

  await ensureBackupImage();

  const spin = spinner(
    `Restoring ${backup.volumes.length} volume(s)...`
  ).start();

  let restored = 0;
  for (const volume of backup.volumes) {
    spin.text = `Restoring volume: ${volume}`;
    const success = await restoreVolume(volume, backupDir);
    if (success) {
      restored++;
    }
  }

  if (restored > 0) {
    spin.succeed(`Restored ${restored} volume(s)`);
  } else {
    spin.warn("No volumes restored");
  }
}

// =============================================================================
// Commands
// =============================================================================

export const updateCommand = new Command("update")
  .description("Update to latest release with full system backup")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(async (options: UpdateOptions) => {
    if (!projectConfigExists()) {
      logger.error("Project not initialized. Run 'cin init' first.");
      process.exit(EXIT_CODES.CONFIG_ERROR);
    }

    // Check Docker availability
    const dockerAvailable = await checkDockerAvailable();
    if (!dockerAvailable) {
      logger.error("Docker is not running or not accessible");
      logger.info("Start Docker and try again");
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }

    // Acquire lock
    if (!acquireLock()) {
      logger.error("Another update/rollback operation is in progress");
      logger.info("Wait for it to complete or remove .cin/.cin-update.lock");
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }

    try {
      await performUpdate(options);
    } finally {
      releaseLock();
      clearCleanups();
    }
  });

async function performUpdate(options: UpdateOptions): Promise<void> {
  const repos = getRepositories();
  if (repos.length === 0) {
    logger.info("No repositories configured.");
    return;
  }

  const config = readProjectConfig();
  const projectDir = getConfigCwd();
  const reposDir = join(projectDir, ".cin", "repos");

  console.log();
  console.log(
    chalk.bold(`Checking updates for ${config?.project?.name ?? "project"}...`)
  );
  console.log();

  // Check for updates
  const updates: RepoUpdate[] = [];
  for (const repo of repos) {
    const update = await checkRepoForUpdates(repo, reposDir);
    if (update) {
      updates.push(update);
    }
  }

  if (updates.length === 0) {
    console.log();
    logger.success("Everything is up to date");
    return;
  }

  // Confirm update
  console.log();
  if (!options.yes) {
    const { confirmed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmed",
        message: `Update ${updates.length} repository(ies)? (will create full backup)`,
        default: true,
      },
    ]);

    if (!confirmed) {
      logger.info("Cancelled");
      return;
    }
  }

  // Create backup
  console.log();
  const currentVersion = updates[0]?.currentTag ?? null;
  const timestamp = new Date()
    .toISOString()
    .replace(TIMESTAMP_REGEX, "-")
    .substring(0, 19);
  const backupName = `backup-${currentVersion ?? "unknown"}-${timestamp}`;

  logger.info("Creating full system backup...");
  const manifest = await createBackup(
    backupName,
    currentVersion,
    repos,
    reposDir,
    projectDir
  );

  if (manifest) {
    printBackupInfo(manifest, backupName);
  }

  // Perform update
  console.log();
  for (const update of updates) {
    await applyRepoUpdate(update, reposDir);
  }

  console.log();
  logger.success(
    `Updated to ${formatVersion(updates[0]?.latestTag ?? "latest")}`
  );
  logger.info("Run 'cin update rollback' to restore previous version");
  logger.info("Run 'cin build' to rebuild Docker images");
}

export const updateRollbackCommand = new Command("rollback")
  .description("Rollback to previous version (restores git, volumes, .env)")
  .option("-y, --yes", "Skip confirmation")
  .action(async (options: RollbackOptions) => {
    if (!projectConfigExists()) {
      logger.error("Project not initialized.");
      process.exit(EXIT_CODES.CONFIG_ERROR);
    }

    // Check Docker availability
    const dockerAvailable = await checkDockerAvailable();
    if (!dockerAvailable) {
      logger.error("Docker is not running or not accessible");
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }

    // Acquire lock
    if (!acquireLock()) {
      logger.error("Another update/rollback operation is in progress");
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }

    try {
      await performRollback(options);
    } finally {
      releaseLock();
      clearCleanups();
    }
  });

async function performRollback(options: RollbackOptions): Promise<void> {
  const backups = listBackups();

  if (backups.length === 0) {
    logger.error("No backups available");
    logger.info("Backups are created automatically when running 'cin update'");
    return;
  }

  const repos = getRepositories();
  const projectDir = getConfigCwd();
  const reposDir = join(projectDir, ".cin", "repos");

  // Show available backups
  printBackupList(backups);

  // Select backup
  const backupIndex = await selectBackup(backups, options.yes ?? false);
  const backup = backups[backupIndex];
  const backupDir = join(getBackupsDir(), backup.name);

  // Verify checksum
  const integrityOk = await verifyBackupIntegrity(
    backup,
    backupDir,
    options.yes ?? false
  );
  if (!integrityOk) {
    return;
  }

  // Confirm
  const confirmed = await confirmRollback(backup, options.yes ?? false);
  if (!confirmed) {
    logger.info("Cancelled");
    return;
  }

  console.log();

  // Stop services before restore
  const composePath = join(projectDir, "docker-compose.yml");
  if (existsSync(composePath)) {
    await stopServices(projectDir);
  }

  // Restore git commits
  await restoreGitCommits(repos, backup, reposDir);

  // Restore .env
  restoreEnvFile(backup, backupDir, projectDir);

  // Restore volumes
  await restoreVolumes(backup, backupDir);

  // Start services
  if (existsSync(composePath)) {
    await startServices(projectDir);
  }

  console.log();
  logger.success(
    `Rolled back to ${formatVersion(backup.version ?? "previous version")}`
  );
}
