import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { getRepositories, projectConfigExists } from "../lib/config.js";
import { formatRepo, logger, spinner } from "../utils/logger.js";

export const buildCommand = new Command("build")
  .description("Build Docker images for repositories")
  .option("-r, --repo <name>", "Build specific repository")
  .option("--no-cache", "Build without Docker cache")
  .option("--parallel", "Build services in parallel")
  .action(async (options) => {
    if (!projectConfigExists()) {
      logger.error("Project not initialized. Run 'cin init' first.");
      process.exit(1);
    }

    let repos = getRepositories();

    if (repos.length === 0) {
      logger.info("No repositories configured. Add one with 'cin repo add'.");
      return;
    }

    if (options.repo) {
      repos = repos.filter((r) => r.name === options.repo);
      if (repos.length === 0) {
        logger.error(`Repository '${options.repo}' not found.`);
        process.exit(1);
      }
    }

    const reposDir = join(process.cwd(), ".cin", "repos");
    let totalBuilt = 0;
    let totalSkipped = 0;

    for (const repo of repos) {
      const result = await buildRepository(repo, reposDir, options);
      if (result === "built") {
        totalBuilt++;
      } else if (result === "skipped") {
        totalSkipped++;
      }
    }

    if (totalBuilt > 0) {
      logger.success(`Built ${totalBuilt} repository(ies)`);
    }
    if (totalSkipped > 0) {
      logger.info(`Skipped ${totalSkipped} repository(ies) (not cloned)`);
    }
  });

/**
 * Build Docker images for a repository
 */
async function buildRepository(repo, reposDir, options) {
  const repoPath = join(reposDir, repo.name);

  if (!existsSync(repoPath)) {
    logger.skip(`${formatRepo(repo.name)}: not cloned (run 'cin pull' first)`);
    return "skipped";
  }

  const composeFile = repo.docker?.compose_file || "docker-compose.yml";
  const composePath = join(repoPath, composeFile);

  if (!existsSync(composePath)) {
    logger.skip(`${formatRepo(repo.name)}: no ${composeFile} found`);
    return "skipped";
  }

  const spin = spinner(`Building ${formatRepo(repo.name)}...`).start();

  try {
    const args = buildDockerComposeArgs(repo, options);
    await runDockerCompose(repoPath, args, spin);
    spin.succeed(`${formatRepo(repo.name)}: built successfully`);
    return "built";
  } catch (error) {
    spin.fail(`${formatRepo(repo.name)}: ${error.message}`);
    return "failed";
  }
}

/**
 * Build docker-compose command arguments
 */
function buildDockerComposeArgs(repo, options) {
  const composeFile = repo.docker?.compose_file || "docker-compose.yml";
  const args = ["-f", composeFile, "build"];

  // Add --no-cache if specified
  if (!options.cache) {
    args.push("--no-cache");
  }

  // Add --parallel if specified
  if (options.parallel) {
    args.push("--parallel");
  }

  // Add build args from config
  const buildArgs = repo.docker?.build_args || {};
  for (const [key, value] of Object.entries(buildArgs)) {
    args.push("--build-arg", `${key}=${value}`);
  }

  // Add specific services if configured
  const services = repo.docker?.services || [];
  if (services.length > 0) {
    args.push(...services);
  }

  return args;
}

/**
 * Run docker-compose command
 */
function runDockerCompose(cwd, args, spin) {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", ["compose", ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
      // Update spinner with last line of output
      const lines = data.toString().trim().split("\n");
      const lastLine = lines.at(-1);
      if (lastLine) {
        spin.text = lastLine.substring(0, 60);
      }
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      // Docker compose outputs progress to stderr
      const lines = data.toString().trim().split("\n");
      const lastLine = lines.at(-1);
      if (lastLine && !lastLine.includes("error")) {
        spin.text = lastLine.substring(0, 60);
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `Exit code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start docker compose: ${err.message}`));
    });
  });
}
