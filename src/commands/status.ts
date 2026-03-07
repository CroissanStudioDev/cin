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
} from "../lib/config.js";

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

async function printRepoStatus(
  repo: Repository,
  reposDir: string
): Promise<void> {
  const repoPath = join(reposDir, repo.name);

  if (!existsSync(repoPath)) {
    console.log(`  ${chalk.gray("○")} ${chalk.yellow(repo.name)} - not cloned`);
    return;
  }

  try {
    const git = simpleGit(repoPath);
    const status = await git.status();
    const head = await git.revparse(["--short", "HEAD"]);
    const submoduleCount = await getSubmoduleCount(git);

    const statusIcon = status.isClean() ? chalk.green("✓") : chalk.yellow("*");
    const submoduleInfo =
      submoduleCount > 0 ? chalk.gray(` [${submoduleCount} submodules]`) : "";

    console.log(
      `  ${statusIcon} ${chalk.yellow(repo.name)} @ ${chalk.cyan(head)}${submoduleInfo}`
    );

    if (!status.isClean()) {
      console.log(
        chalk.gray(
          `      ${status.modified.length} modified, ${status.not_added.length} untracked`
        )
      );
    }
  } catch {
    console.log(
      `  ${chalk.red("✗")} ${chalk.yellow(repo.name)} - error reading status`
    );
  }
}

export const statusCommand = new Command("status")
  .description("Show project status")
  .action(async () => {
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
      for (const repo of repos) {
        await printRepoStatus(repo, reposDir);
      }
    }
    console.log();
  });
