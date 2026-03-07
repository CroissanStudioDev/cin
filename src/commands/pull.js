import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import simpleGit from "simple-git";
import {
  getRepositories,
  projectConfigExists,
  resolveSshKey,
} from "../lib/config.js";
import { formatRepo, logger, spinner } from "../utils/logger.js";

// Regex for parsing submodule status line (moved to top level for performance)
const SUBMODULE_STATUS_PATTERN = /^[\s-+]?([a-f0-9]+)\s+(\S+)/;

export const pullCommand = new Command("pull")
  .description("Pull updates from repositories")
  .option("-r, --repo <name>", "Pull specific repository")
  .option("-a, --all", "Pull all repositories (default)")
  .option("--no-submodules", "Do not update submodules")
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
    const updateSubmodules = options.submodules;

    for (const repo of repos) {
      await pullRepository(repo, reposDir, updateSubmodules);
    }

    logger.success("All repositories updated");
  });

/**
 * Build SSH command for git operations
 */
function buildSshCommand(sshKeyPath) {
  return `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no`;
}

/**
 * Get SSH key path for a submodule
 */
function getSubmoduleSshKey(repo, submodulePath) {
  const submoduleKeys = repo.submodules?.keys || {};
  const keyName = submoduleKeys[submodulePath];

  if (keyName) {
    return resolveSshKey(keyName);
  }

  // Fall back to main repo SSH key
  if (repo.ssh_key) {
    return resolveSshKey(repo.ssh_key);
  }

  return null;
}

/**
 * Initialize and update submodules
 */
async function updateSubmodules(repo, repoPath, spin) {
  const repoGit = simpleGit(repoPath);

  // Get list of submodules
  const submoduleStatus = await repoGit.subModule(["status"]);

  if (!submoduleStatus.trim()) {
    return 0; // No submodules
  }

  const submodules = submoduleStatus
    .trim()
    .split("\n")
    .map((line) => {
      // Format: " <commit> <path> (<describe>)" or "-<commit> <path>"
      const match = line.match(SUBMODULE_STATUS_PATTERN);
      return match ? { commit: match[1], path: match[2] } : null;
    })
    .filter(Boolean);

  if (submodules.length === 0) {
    return 0;
  }

  spin.text = `Updating ${submodules.length} submodule(s)...`;

  // Update each submodule with appropriate SSH key
  for (const submodule of submodules) {
    const sshKey = getSubmoduleSshKey(repo, submodule.path);

    if (sshKey) {
      // Set SSH command for this submodule
      await repoGit.env("GIT_SSH_COMMAND", buildSshCommand(sshKey));
    }

    const recursive = repo.submodules?.recursive !== false;
    const args = ["update", "--init"];
    if (recursive) {
      args.push("--recursive");
    }
    args.push("--", submodule.path);

    await repoGit.subModule(args);
  }

  return submodules.length;
}

/**
 * Pull or clone a repository with submodules support
 */
async function pullRepository(repo, reposDir, shouldUpdateSubmodules = true) {
  const repoPath = join(reposDir, repo.name);
  const spin = spinner(`Pulling ${formatRepo(repo.name)}...`).start();

  // Check if submodules are enabled for this repo
  const submodulesEnabled =
    shouldUpdateSubmodules && repo.submodules?.enabled !== false;

  try {
    // Configure SSH key if specified
    const sshKey = repo.ssh_key ? resolveSshKey(repo.ssh_key) : null;
    const gitEnv = sshKey ? { GIT_SSH_COMMAND: buildSshCommand(sshKey) } : {};

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
      await git.clone(repo.url, repoPath, ["--branch", repo.branch]);

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
    spin.fail(`${formatRepo(repo.name)}: ${error.message}`);
  }
}
