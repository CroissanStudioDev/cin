import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { simpleGit } from "simple-git";
import {
  getRepositories,
  projectConfigExists,
  resolveSshKey,
} from "../../lib/config.js";
import { EXIT_CODES } from "../../utils/exit-codes.js";
import {
  formatRepo,
  formatVersion,
  logger,
  spinner,
} from "../../utils/logger.js";

interface CheckoutOptions {
  fetch?: boolean;
  force?: boolean;
  repo?: string;
}

const VERSION_PREFIX_REGEX = /^v/;

function buildSshCommand(sshKeyPath: string): string {
  return `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no`;
}

export const releaseCheckoutCommand = new Command("checkout")
  .description("Switch to a specific release (git tag)")
  .argument("<version>", "Version tag to checkout (e.g., v1.0.0)")
  .option("-r, --repo <name>", "Checkout only specific repository")
  .option("-f, --fetch", "Fetch tags from remote before checkout")
  .option("--force", "Force checkout even with uncommitted changes")
  .action(async (version: string, options: CheckoutOptions) => {
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

    // Normalize tag (ensure 'v' prefix for consistency)
    const tag = version.startsWith("v") ? version : `v${version}`;

    let successCount = 0;
    let failCount = 0;

    for (const repo of repos) {
      const result = await checkoutRelease(repo, reposDir, tag, options);
      if (result === "success") {
        successCount++;
      } else if (result === "failed") {
        failCount++;
      }
    }

    if (successCount > 0) {
      console.log();
      logger.success(
        `Switched ${successCount} repository(ies) to ${formatVersion(tag)}`
      );
      logger.info("Run 'cin build' to rebuild with this version");
    }

    if (failCount > 0) {
      logger.warn(`${failCount} repository(ies) failed to checkout`);
    }
  });

async function checkoutRelease(
  repo: { name: string; ssh_key?: string; submodules?: unknown[] },
  reposDir: string,
  tag: string,
  options: CheckoutOptions
): Promise<"success" | "skipped" | "failed"> {
  const repoPath = join(reposDir, repo.name);

  if (!existsSync(repoPath)) {
    logger.skip(`${formatRepo(repo.name)}: not cloned`);
    return "skipped";
  }

  const git = simpleGit(repoPath);

  // Configure SSH if needed
  const sshKey = repo.ssh_key ? resolveSshKey(repo.ssh_key) : null;
  if (sshKey) {
    git.env("GIT_SSH_COMMAND", buildSshCommand(sshKey));
  }

  // Fetch tags if requested
  if (options.fetch) {
    const fetchSpin = spinner(
      `Fetching tags for ${formatRepo(repo.name)}...`
    ).start();
    try {
      await git.fetch(["--tags", "--force"]);
      fetchSpin.succeed(`Fetched tags for ${formatRepo(repo.name)}`);
    } catch (error) {
      fetchSpin.fail(`Failed to fetch: ${(error as Error).message}`);
      return "failed";
    }
  }

  // Check if tag exists
  try {
    const tags = await git.tags();

    // Try both with and without 'v' prefix
    const tagExists =
      tags.all.includes(tag) ||
      tags.all.includes(tag.replace(VERSION_PREFIX_REGEX, ""));
    const actualTag = tags.all.includes(tag)
      ? tag
      : tag.replace(VERSION_PREFIX_REGEX, "");

    if (!tagExists) {
      logger.error(
        `${formatRepo(repo.name)}: tag ${formatVersion(tag)} not found`
      );
      logger.info(
        `  Available tags: ${tags.all.slice(0, 5).join(", ") || "none"}`
      );
      return "failed";
    }

    // Check for uncommitted changes
    const status = await git.status();
    if (!(status.isClean() || options.force)) {
      logger.error(`${formatRepo(repo.name)}: has uncommitted changes`);
      logger.info("  Use --force to discard changes, or commit/stash first");
      return "failed";
    }

    // Get current position
    const currentHead = await git.revparse(["--short", "HEAD"]);

    const spin = spinner(
      `Checking out ${formatVersion(actualTag)} in ${formatRepo(repo.name)}...`
    ).start();

    try {
      // Checkout the tag
      if (options.force) {
        await git.checkout([actualTag, "--force"]);
      } else {
        await git.checkout(actualTag);
      }

      // Update submodules if configured
      if (repo.submodules !== undefined) {
        spin.text = `Updating submodules for ${formatRepo(repo.name)}...`;
        await git.subModule(["update", "--init", "--recursive"]);
      }

      const newHead = await git.revparse(["--short", "HEAD"]);
      spin.succeed(
        `${formatRepo(repo.name)}: ${currentHead} → ${formatVersion(actualTag)} (${newHead})`
      );

      return "success";
    } catch (error) {
      spin.fail(`${formatRepo(repo.name)}: ${(error as Error).message}`);
      return "failed";
    }
  } catch (error) {
    logger.error(`${formatRepo(repo.name)}: ${(error as Error).message}`);
    return "failed";
  }
}
