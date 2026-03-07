import chalk from "chalk";
import { Command } from "commander";
import { getRepositories, projectConfigExists } from "../../lib/config.js";
import { logger } from "../../utils/logger.js";

export const listCommand = new Command("list")
  .alias("ls")
  .description("List all repositories")
  .action(() => {
    if (!projectConfigExists()) {
      logger.error("Project not initialized. Run 'cin init' first.");
      process.exit(1);
    }

    const repos = getRepositories();

    if (repos.length === 0) {
      logger.info("No repositories configured. Add one with 'cin repo add'.");
      return;
    }

    console.log(chalk.bold("\nRepositories:\n"));

    for (const repo of repos) {
      console.log(chalk.yellow(`  ${repo.name}`));
      console.log(chalk.gray(`    URL: ${repo.url}`));
      console.log(chalk.gray(`    Branch: ${repo.branch}`));
      if (repo.ssh_key) {
        console.log(chalk.gray(`    SSH Key: ${repo.ssh_key}`));
      }
      console.log();
    }
  });
