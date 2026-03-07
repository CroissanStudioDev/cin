import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import type { Ora } from "ora";
import { simpleGit } from "simple-git";
import {
  getRepositories,
  projectConfigExists,
  type Repository,
  resolveSshKey,
} from "../lib/config.js";
import { formatRepo, logger, spinner } from "../utils/logger.js";

// Regex for parsing submodule status line (moved to top level for performance)
const SUBMODULE_STATUS_PATTERN = /^[\s-+]?([a-f0-9]+)\s+(\S+)/;

interface Submodule {
  commit: string;
  path: string;
}

interface PullOptions {
  all?: boolean;
  repo?: string;
  submodules: boolean;
}

export const pullCommand = new Command("pull")
  .description("Pull updates from repositories")
  .option("-r, --repo <name>", "Pull specific repository")
  .option("-a, --all", "Pull all repositories (default)")
  .option("--no-submodules", "Do not update submodules")
  .action(async (options: PullOptions) => {
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
    const updateSubmodules = options.submodules;

    for (const repo of repos) {
      await pullRepository(repo, reposDir, updateSubmodules);
    }

    logger.success("All repositories updated");
  });

function buildSshCommand(sshKeyPath: string): string {
  return `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no`;
}

function getSubmoduleSshKey(
  repo: Repository,
  submodulePath: string
): string | null {
  const submoduleConfig = repo.submodules?.find(
    (s) => s.path === submodulePath
  );

  if (submoduleConfig?.ssh_key) {
    return resolveSshKey(submoduleConfig.ssh_key);
  }

  // Fall back to main repo SSH key
  if (repo.ssh_key) {
    return resolveSshKey(repo.ssh_key);
  }

  return null;
}

async function updateSubmodules(
  repo: Repository,
  repoPath: string,
  spin: Ora
): Promise<number> {
  const repoGit = simpleGit(repoPath);

  // Get list of submodules
  const submoduleStatus = await repoGit.subModule(["status"]);

  if (!submoduleStatus.trim()) {
    return 0; // No submodules
  }

  const submodules: Submodule[] = submoduleStatus
    .trim()
    .split("\n")
    .map((line) => {
      // Format: " <commit> <path> (<describe>)" or "-<commit> <path>"
      const match = line.match(SUBMODULE_STATUS_PATTERN);
      return match ? { commit: match[1], path: match[2] } : null;
    })
    .filter((s): s is Submodule => s !== null);

  if (submodules.length === 0) {
    return 0;
  }

  spin.text = `Updating ${submodules.length} submodule(s)...`;

  // Update each submodule with appropriate SSH key
  for (const submodule of submodules) {
    const sshKey = getSubmoduleSshKey(repo, submodule.path);

    if (sshKey) {
      // Set SSH command for this submodule
      repoGit.env("GIT_SSH_COMMAND", buildSshCommand(sshKey));
    }

    const args = ["update", "--init", "--recursive", "--", submodule.path];
    await repoGit.subModule(args);
  }

  return submodules.length;
}

async function pullRepository(
  repo: Repository,
  reposDir: string,
  shouldUpdateSubmodules = true
): Promise<void> {
  const repoPath = join(reposDir, repo.name);
  const spin = spinner(`Pulling ${formatRepo(repo.name)}...`).start();

  // Check if submodules are enabled for this repo
  const submodulesEnabled =
    shouldUpdateSubmodules && repo.submodules !== undefined;

  try {
    // Configure SSH key if specified
    const sshKey = repo.ssh_key ? resolveSshKey(repo.ssh_key) : null;
    const gitEnv: Record<string, string> = sshKey
      ? { GIT_SSH_COMMAND: buildSshCommand(sshKey) }
      : {};

    if (existsSync(repoPath)) {
      // Repository exists, pull updates
      const repoGit = simpleGit(repoPath).env(gitEnv);

      const statusBefore = await repoGit.revparse(["HEAD"]);
      await repoGit.pull("origin", repo.branch);
      const statusAfter = await repoGit.revparse(["HEAD"]);

      let submoduleCount = 0;
      if (submodulesEnabled) {
        submoduleCount = await updateSubmodules(repo, repoPath, spin);
      }

      if (statusBefore === statusAfter && submoduleCount === 0) {
        spin.stop();
        logger.skip(
          `${formatRepo(repo.name)}: already at ${statusAfter.substring(0, 7)}`
        );
      } else {
        const log = await repoGit.log({ from: statusBefore, to: statusAfter });
        const submoduleInfo =
          submoduleCount > 0 ? `, ${submoduleCount} submodule(s)` : "";
        spin.succeed(
          `${formatRepo(repo.name)}: ${log.total} new commit(s)${submoduleInfo}`
        );
      }
    } else {
      // Clone repository
      spin.text = `Cloning ${formatRepo(repo.name)}...`;

      const git = simpleGit().env(gitEnv);
      await git.clone(repo.url, repoPath, ["--branch", repo.branch ?? "main"]);

      // Initialize and update submodules after clone
      let submoduleCount = 0;
      if (submodulesEnabled) {
        submoduleCount = await updateSubmodules(repo, repoPath, spin);
      }

      const submoduleInfo =
        submoduleCount > 0 ? ` with ${submoduleCount} submodule(s)` : "";
      spin.succeed(`${formatRepo(repo.name)}: cloned${submoduleInfo}`);
    }
  } catch (error) {
    spin.fail(`${formatRepo(repo.name)}: ${(error as Error).message}`);
  }
}
