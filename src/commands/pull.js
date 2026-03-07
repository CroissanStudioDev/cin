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

export const pullCommand = new Command("pull")
  .description("Pull updates from repositories")
  .option("-r, --repo <name>", "Pull specific repository")
  .option("-a, --all", "Pull all repositories (default)")
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

    for (const repo of repos) {
      await pullRepository(repo, reposDir);
    }

    logger.success("All repositories updated");
  });

async function pullRepository(repo, reposDir) {
  const repoPath = join(reposDir, repo.name);
  const spin = spinner(`Pulling ${formatRepo(repo.name)}...`).start();

  try {
    const gitOptions = {};

    // Configure SSH key if specified
    if (repo.ssh_key) {
      const sshKey = resolveSshKey(repo.ssh_key);
      if (sshKey) {
        gitOptions.config = [
          `core.sshCommand=ssh -i ${sshKey} -o StrictHostKeyChecking=no`,
        ];
      }
    }

    const git = simpleGit(gitOptions);

    if (existsSync(repoPath)) {
      // Repository exists, pull updates
      const repoGit = simpleGit(repoPath);

      const statusBefore = await repoGit.revparse(["HEAD"]);
      await repoGit.pull("origin", repo.branch);
      const statusAfter = await repoGit.revparse(["HEAD"]);

      if (statusBefore === statusAfter) {
        spin.stop();
        logger.skip(
          `${formatRepo(repo.name)}: already at ${statusAfter.substring(0, 7)}`
        );
      } else {
        const log = await repoGit.log({ from: statusBefore, to: statusAfter });
        spin.succeed(`${formatRepo(repo.name)}: ${log.total} new commit(s)`);
      }
    } else {
      // Clone repository
      spin.text = `Cloning ${formatRepo(repo.name)}...`;
      await git.clone(repo.url, repoPath, ["--branch", repo.branch]);
      spin.succeed(`${formatRepo(repo.name)}: cloned`);
    }
  } catch (error) {
    spin.fail(`${formatRepo(repo.name)}: ${error.message}`);
  }
}
