import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, platform, release } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { create as createTar } from "tar";
import { getProjectName } from "../../lib/secrets.js";
import { formatPath, logger, spinner } from "../../utils/logger.js";
import { sanitizeEnvFile, sanitizeText } from "../../utils/sanitizer.js";

interface CollectOptions {
  days: string;
  includeEnv: boolean;
  output?: string;
  target: string;
}

function getTimestamp(): string {
  return new Date().toISOString().split("T")[0];
}

function runCommand(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 30_000 }).trim();
  } catch {
    return "";
  }
}

function collectSystemInfo(): Record<string, unknown> {
  return {
    collected_at: new Date().toISOString(),
    hostname: hostname(),
    platform: platform(),
    os_release: release(),
    docker_version: runCommand("docker --version"),
    docker_compose_version: runCommand("docker compose version"),
    disk_usage: runCommand("df -h / 2>/dev/null || echo 'N/A'"),
    memory: runCommand("free -h 2>/dev/null || echo 'N/A'"),
  };
}

function collectDockerInfo(currentDir: string): Record<string, string> {
  const info: Record<string, string> = {};

  // Running containers
  info["docker-ps.txt"] = runCommand(
    "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
  );

  // Docker stats snapshot
  info["docker-stats.txt"] = runCommand(
    "docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'"
  );

  // Compose config
  if (existsSync(currentDir)) {
    const composePs = spawnSync("docker", ["compose", "ps"], {
      cwd: currentDir,
      encoding: "utf-8",
    });
    info["compose-ps.txt"] = composePs.stdout || composePs.stderr || "";
  }

  return info;
}

function collectServiceLogs(
  currentDir: string,
  days: number,
  projectName: string
): Record<string, string> {
  const logs: Record<string, string> = {};
  const since = `${days * 24}h`;

  if (!existsSync(currentDir)) {
    return logs;
  }

  // Get list of services
  const servicesResult = spawnSync("docker", ["compose", "ps", "--services"], {
    cwd: currentDir,
    encoding: "utf-8",
  });

  const services = (servicesResult.stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const service of services) {
    const result = spawnSync(
      "docker",
      ["compose", "logs", "--no-color", "--since", since, service],
      { cwd: currentDir, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
    );

    const rawLogs = result.stdout || "";
    if (rawLogs) {
      const { sanitized } = sanitizeText(rawLogs, projectName);
      logs[`${service}.log`] = sanitized;
    }
  }

  return logs;
}

function collectManifest(currentDir: string): string | null {
  const manifestPath = join(currentDir, "manifest.json");
  if (existsSync(manifestPath)) {
    return readFileSync(manifestPath, "utf-8");
  }
  return null;
}

function collectEnvSanitized(currentDir: string): string | null {
  const envPath = join(currentDir, ".env");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    return sanitizeEnvFile(content);
  }
  return null;
}

function collectComposeFile(currentDir: string): string | null {
  const composePath = join(currentDir, "docker-compose.yml");
  if (existsSync(composePath)) {
    return readFileSync(composePath, "utf-8");
  }
  return null;
}

function buildTimeline(currentDir: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];

  // Check state file for deploy history
  const statePath = join(currentDir, "..", ".cin", "state.json");
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      events.push({
        type: "deploy",
        version: state.current_version,
        timestamp: state.deployed_at,
      });
    } catch {
      // Ignore parse errors
    }
  }

  // Check versions directory
  const versionsDir = join(currentDir, "..", "versions");
  if (existsSync(versionsDir)) {
    const versions = readdirSync(versionsDir);
    for (const version of versions) {
      events.push({
        type: "backup",
        version,
        path: join(versionsDir, version),
      });
    }
  }

  return events;
}

export const collectCommand = new Command("collect")
  .description("Collect logs for diagnostics (safe to share with vendor)")
  .option("-d, --days <n>", "Collect logs for last N days", "7")
  .option("-t, --target <path>", "Target directory", "/opt/app")
  .option("-o, --output <path>", "Output file path")
  .option("--include-env", "Include sanitized .env file")
  .action(async (options: CollectOptions) => {
    const projectName = getProjectName();
    const days = Number.parseInt(options.days, 10) || 7;
    const timestamp = getTimestamp();
    const archiveName = `cin-logs-${timestamp}`;
    const currentDir = join(options.target, "current");

    const spin = spinner("Collecting logs...").start();

    // Create temp directory for collection
    const tempDir = join(options.target, ".cin", "logs-temp", archiveName);
    mkdirSync(tempDir, { recursive: true });

    try {
      // 1. System info
      spin.text = "Collecting system info...";
      const systemDir = join(tempDir, "system");
      mkdirSync(systemDir, { recursive: true });

      const systemInfo = collectSystemInfo();
      writeFileSync(
        join(systemDir, "info.json"),
        JSON.stringify(systemInfo, null, 2)
      );

      const dockerInfo = collectDockerInfo(currentDir);
      for (const [filename, content] of Object.entries(dockerInfo)) {
        if (content) {
          writeFileSync(join(systemDir, filename), content);
        }
      }

      // 2. Service logs
      spin.text = "Collecting service logs...";
      const servicesDir = join(tempDir, "services");
      mkdirSync(servicesDir, { recursive: true });

      const serviceLogs = collectServiceLogs(currentDir, days, projectName);
      let totalLogSize = 0;
      for (const [filename, content] of Object.entries(serviceLogs)) {
        writeFileSync(join(servicesDir, filename), content);
        totalLogSize += content.length;
      }

      // 3. Config files
      spin.text = "Collecting configuration...";
      const configDir = join(tempDir, "config");
      mkdirSync(configDir, { recursive: true });

      const manifest = collectManifest(currentDir);
      if (manifest) {
        writeFileSync(join(configDir, "manifest.json"), manifest);
      }

      const compose = collectComposeFile(currentDir);
      if (compose) {
        writeFileSync(join(configDir, "docker-compose.yml"), compose);
      }

      if (options.includeEnv) {
        const envSanitized = collectEnvSanitized(currentDir);
        if (envSanitized) {
          writeFileSync(join(configDir, "env.sanitized"), envSanitized);
        }
      }

      // 4. Timeline
      const timeline = buildTimeline(currentDir);
      writeFileSync(
        join(tempDir, "timeline.json"),
        JSON.stringify(timeline, null, 2)
      );

      // 5. README
      const readme = `CIN CLI Diagnostic Logs
=======================

Collected: ${new Date().toISOString()}
Project: ${projectName}
Days: ${days}

Contents:
- system/       System information (OS, Docker, disk usage)
- services/     Container logs (sanitized)
- config/       Configuration files
- timeline.json Deployment history

This archive has been sanitized to remove sensitive data.
Safe to share with your vendor for diagnostics.
`;
      writeFileSync(join(tempDir, "README.txt"), readme);

      // 6. Create archive
      spin.text = "Creating archive...";
      const outputPath =
        options.output || join(process.cwd(), `${archiveName}.tar.gz`);

      await createTar(
        {
          gzip: true,
          file: outputPath,
          cwd: join(tempDir, ".."),
        },
        [archiveName]
      );

      spin.succeed("Logs collected");

      // Summary
      console.log();
      logger.info(`Project: ${projectName}`);
      logger.info(`Period: last ${days} day(s)`);
      logger.info(`Services: ${Object.keys(serviceLogs).length}`);
      logger.info(
        `Log size: ${(totalLogSize / 1024 / 1024).toFixed(1)} MB (before compression)`
      );
      console.log();
      logger.success(`Archive created: ${formatPath(outputPath)}`);
      console.log();
      logger.info("Secrets have been automatically removed from logs.");
      logger.info("Safe to share with vendor for diagnostics.");
    } finally {
      // Cleanup temp directory
      rmSync(join(tempDir, ".."), { recursive: true, force: true });
    }
  });
