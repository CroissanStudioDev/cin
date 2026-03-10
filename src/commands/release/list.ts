import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { simpleGit } from "simple-git";
import {
  getRepositories,
  projectConfigExists,
  readProjectConfig,
  resolveSshKey,
} from "../../lib/config.js";
import { EXIT_CODES } from "../../utils/exit-codes.js";
import {
  formatRepo,
  formatVersion,
  logger,
  spinner,
} from "../../utils/logger.js";

interface ReleaseInfo {
  commit: string;
  date: string;
  isCurrent: boolean;
  message: string;
  tag: string;
}

interface ListOptions {
  fetch?: boolean;
  limit: number;
  repo?: string;
}

function buildSshCommand(sshKeyPath: string): string {
  return `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no`;
}

export const releaseListCommand = new Command("list")
  .description("List available releases (git tags)")
  .option("-r, --repo <name>", "Show releases for specific repository")
  .option("-f, --fetch", "Fetch latest tags from remote")
  .option("-l, --limit <n>", "Limit number of releases shown", "10")
  .action(async (options: ListOptions) => {
    if (!projectConfigExists()) {
      logger.error("Project not initialized. Run 'cin init' first.");
      process.exit(EXIT_CODES.CONFIG_ERROR);
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
        process.exit(EXIT_CODES.CONFIG_ERROR);
      }
    }

    const reposDir = join(process.cwd(), ".cin", "repos");
    const config = readProjectConfig();

    console.log();
    console.log(
      chalk.bold(`Releases for ${config?.project?.name ?? "project"}`)
    );
    console.log();

    for (const repo of repos) {
      await listRepoReleases(repo, reposDir, options);
    }
  });

async function fetchRepoTags(
  git: ReturnType<typeof simpleGit>,
  repo: { name: string; ssh_key?: string }
): Promise<void> {
  const spin = spinner(`Fetching tags for ${formatRepo(repo.name)}...`).start();
  try {
    const sshKey = repo.ssh_key ? resolveSshKey(repo.ssh_key) : null;
    if (sshKey) {
      git.env("GIT_SSH_COMMAND", buildSshCommand(sshKey));
    }
    await git.fetch(["--tags", "--force"]);
    spin.succeed(`Fetched tags for ${formatRepo(repo.name)}`);
  } catch (error) {
    spin.fail(`Failed to fetch: ${(error as Error).message}`);
  }
}

async function getReleaseInfo(
  git: ReturnType<typeof simpleGit>,
  tag: string,
  currentCommit: string
): Promise<ReleaseInfo> {
  try {
    // Use ^{} to dereference annotated tags to their commit SHA
    const tagCommit = await git.revparse([`${tag}^{}`]);
    const logResult = await git.log({ from: tag, to: tag, n: 1 });
    const commit = logResult.latest;

    return {
      tag,
      commit: tagCommit.substring(0, 7),
      date: commit?.date ? formatDate(commit.date) : "unknown",
      message: commit?.message?.split("\n")[0] ?? "",
      isCurrent: tagCommit.trim() === currentCommit.trim(),
    };
  } catch {
    return {
      tag,
      commit: "unknown",
      date: "unknown",
      message: "",
      isCurrent: false,
    };
  }
}

function displayReleases(releases: ReleaseInfo[]): void {
  for (const release of releases) {
    const currentMarker = release.isCurrent ? chalk.green(" (current)") : "";
    const tagDisplay = formatVersion(release.tag);

    console.log(
      `  ${tagDisplay}${currentMarker} - ${chalk.gray(release.commit)} - ${chalk.gray(release.date)}`
    );
    if (release.message) {
      console.log(chalk.gray(`    ${release.message.substring(0, 60)}`));
    }
  }
}

async function listRepoReleases(
  repo: { name: string; ssh_key?: string; branch?: string },
  reposDir: string,
  options: ListOptions
): Promise<void> {
  const repoPath = join(reposDir, repo.name);

  if (!existsSync(repoPath)) {
    console.log(`${formatRepo(repo.name)}: ${chalk.yellow("not cloned")}`);
    console.log();
    return;
  }

  const git = simpleGit(repoPath);

  if (options.fetch) {
    await fetchRepoTags(git, repo);
  }

  try {
    const currentCommit = await git.revparse(["HEAD"]);
    const tagsResult = await git.tags(["--sort=-version:refname"]);
    const tags = tagsResult.all.slice(0, options.limit);

    console.log(`${formatRepo(repo.name)}:`);

    if (tags.length === 0) {
      console.log(chalk.gray("  No releases found"));
      console.log(
        chalk.gray("  Create one with: cin release create <version>")
      );
      console.log();
      return;
    }

    const releases: ReleaseInfo[] = [];
    for (const tag of tags) {
      const info = await getReleaseInfo(git, tag, currentCommit);
      releases.push(info);
    }

    displayReleases(releases);

    if (tagsResult.all.length > options.limit) {
      console.log(
        chalk.gray(`  ... and ${tagsResult.all.length - options.limit} more`)
      );
    }

    await checkForUpdates(git, repo, currentCommit);
    console.log();
  } catch (error) {
    console.log(`  ${chalk.red("Error:")} ${(error as Error).message}`);
    console.log();
  }
}

async function checkForUpdates(
  git: ReturnType<typeof simpleGit>,
  repo: { branch?: string },
  currentCommit: string
): Promise<void> {
  try {
    const branch = repo.branch ?? "main";
    const remoteBranch = `origin/${branch}`;

    // Check if we have remote tracking
    const remoteCommit = await git.revparse([remoteBranch]).catch(() => null);

    if (!remoteCommit) {
      return;
    }

    if (remoteCommit.trim() !== currentCommit.trim()) {
      // Count commits behind
      const behindLog = await git.log({
        from: currentCommit.trim(),
        to: remoteCommit.trim(),
      });

      if (behindLog.total > 0) {
        console.log();
        console.log(
          chalk.yellow(
            `  ⚠ ${behindLog.total} commit(s) behind ${remoteBranch}`
          )
        );
        console.log(chalk.gray(`    Run 'cin pull' to update`));
      }
    }
  } catch {
    // Ignore errors checking remote
  }
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return "today";
    }
    if (diffDays === 1) {
      return "yesterday";
    }
    if (diffDays < 7) {
      return `${diffDays} days ago`;
    }
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
    }

    return date.toISOString().split("T")[0];
  } catch {
    return dateStr;
  }
}
