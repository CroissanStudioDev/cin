import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { type SimpleGit, simpleGit } from "simple-git";
import {
  getGlobalConfigPath,
  getProjectConfigPath,
  getRepositories,
  getSshKeys,
  globalConfigExists,
  projectConfigExists,
  type Repository,
  readProjectConfig,
  resolveSshKey,
} from "../lib/config.js";
import { spinner } from "../utils/logger.js";

interface StatusOptions {
  fetch?: boolean;
}

function buildSshCommand(sshKeyPath: string): string {
  return `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no`;
}

function printGlobalStatus(): void {
  console.log(chalk.bold("Global Config:"));
  if (globalConfigExists()) {
    console.log(chalk.green(`  ✓ ${getGlobalConfigPath()}`));
    const keys = getSshKeys();
    const keyCount = Object.keys(keys).length;
    console.log(chalk.gray(`    SSH Keys: ${keyCount}`));
  } else {
    console.log(chalk.yellow("  ✗ Not initialized"));
  }
  console.log();
}

function printProjectStatus(): boolean {
  console.log(chalk.bold("Project Config:"));
  if (!projectConfigExists()) {
    console.log(chalk.yellow("  ✗ Not initialized"));
    console.log();
    return false;
  }

  console.log(chalk.green(`  ✓ ${getProjectConfigPath()}`));
  const config = readProjectConfig();
  console.log(chalk.gray(`    Project: ${config?.project?.name ?? "unnamed"}`));
  console.log(chalk.gray(`    Vendor: ${config?.vendor?.name ?? "not set"}`));
  console.log();
  return true;
}

async function getSubmoduleCount(git: SimpleGit): Promise<number> {
  try {
    const submoduleStatus = await git.subModule(["status"]);
    if (!submoduleStatus.trim()) {
      return 0;
    }
    return submoduleStatus.trim().split("\n").length;
  } catch {
    return 0;
  }
}

async function getRemoteStatus(
  git: SimpleGit,
  repo: Repository
): Promise<{ ahead: number; behind: number } | null> {
  try {
    const branch = repo.branch ?? "main";
    const remoteBranch = `origin/${branch}`;

    // Get local and remote commits
    const localCommit = await git.revparse(["HEAD"]);
    const remoteCommit = await git.revparse([remoteBranch]).catch(() => null);

    if (!remoteCommit) {
      return null;
    }

    if (localCommit.trim() === remoteCommit.trim()) {
      return { ahead: 0, behind: 0 };
    }

    // Count commits ahead
    const aheadLog = await git
      .log({
        from: remoteCommit.trim(),
        to: localCommit.trim(),
      })
      .catch(() => ({ total: 0 }));

    // Count commits behind
    const behindLog = await git
      .log({
        from: localCommit.trim(),
        to: remoteCommit.trim(),
      })
      .catch(() => ({ total: 0 }));

    return {
      ahead: aheadLog.total,
      behind: behindLog.total,
    };
  } catch {
    return null;
  }
}

async function getLatestTag(git: SimpleGit): Promise<string | null> {
  try {
    const tags = await git.tags(["--sort=-version:refname"]);
    return tags.all[0] ?? null;
  } catch {
    return null;
  }
}

async function printRepoStatus(
  repo: Repository,
  reposDir: string,
  options: StatusOptions
): Promise<void> {
  const repoPath = join(reposDir, repo.name);

  if (!existsSync(repoPath)) {
    console.log(`  ${chalk.gray("○")} ${chalk.yellow(repo.name)} - not cloned`);
    return;
  }

  try {
    const git = simpleGit(repoPath);

    // Fetch if requested
    if (options.fetch) {
      const sshKey = repo.ssh_key ? resolveSshKey(repo.ssh_key) : null;
      if (sshKey) {
        git.env("GIT_SSH_COMMAND", buildSshCommand(sshKey));
      }
      await git.fetch(["--tags"]);
    }

    const status = await git.status();
    const head = await git.revparse(["--short", "HEAD"]);
    const submoduleCount = await getSubmoduleCount(git);
    const latestTag = await getLatestTag(git);
    const remoteStatus = await getRemoteStatus(git, repo);

    // Determine status icon
    let statusIcon = chalk.green("✓");
    if (!status.isClean()) {
      statusIcon = chalk.yellow("*");
    } else if (remoteStatus && remoteStatus.behind > 0) {
      statusIcon = chalk.yellow("↓");
    }

    const submoduleInfo =
      submoduleCount > 0 ? chalk.gray(` [${submoduleCount} submodules]`) : "";
    const tagInfo = latestTag ? chalk.magenta(` ${latestTag}`) : "";

    console.log(
      `  ${statusIcon} ${chalk.yellow(repo.name)} @ ${chalk.cyan(head)}${tagInfo}${submoduleInfo}`
    );

    // Show local changes
    if (!status.isClean()) {
      console.log(
        chalk.gray(
          `      ${status.modified.length} modified, ${status.not_added.length} untracked`
        )
      );
    }

    // Show remote status
    if (remoteStatus) {
      if (remoteStatus.behind > 0) {
        console.log(
          chalk.yellow(`      ↓ ${remoteStatus.behind} commit(s) behind origin`)
        );
      }
      if (remoteStatus.ahead > 0) {
        console.log(
          chalk.cyan(`      ↑ ${remoteStatus.ahead} commit(s) ahead of origin`)
        );
      }
    }
  } catch {
    console.log(
      `  ${chalk.red("✗")} ${chalk.yellow(repo.name)} - error reading status`
    );
  }
}

export const statusCommand = new Command("status")
  .description("Show project status")
  .option("-f, --fetch", "Fetch latest from remote before showing status")
  .action(async (options: StatusOptions) => {
    console.log(chalk.bold("\n=== CIN Status ===\n"));

    printGlobalStatus();

    if (!printProjectStatus()) {
      return;
    }

    const repos = getRepositories();
    console.log(chalk.bold(`Repositories (${repos.length}):`));

    if (repos.length === 0) {
      console.log(chalk.gray("  No repositories configured"));
    } else {
      const reposDir = join(process.cwd(), ".cin", "repos");

      // Show fetching spinner if --fetch
      if (options.fetch) {
        const spin = spinner("Fetching from remote...").start();
        spin.stop();
      }

      for (const repo of repos) {
        await printRepoStatus(repo, reposDir, options);
      }
    }
    console.log();
  });
