import chalk from "chalk";
import { Command } from "commander";
import { getSshKeys, globalConfigExists } from "../../lib/config.js";
import { logger } from "../../utils/logger.js";

export const listCommand = new Command("list")
  .alias("ls")
  .description("List all SSH keys")
  .action(() => {
    if (!globalConfigExists()) {
      logger.error("Global config not found. Run 'cin init --global' first.");
      process.exit(1);
    }

    const keys = getSshKeys();
    const keyNames = Object.keys(keys);

    if (keyNames.length === 0) {
      logger.info("No SSH keys configured. Add one with 'cin key add'.");
      return;
    }

    console.log(chalk.bold("\nSSH Keys:\n"));

    for (const name of keyNames) {
      console.log(chalk.yellow(`  ${name}`));
      console.log(chalk.gray(`    ${keys[name]}`));
      console.log();
    }
  });
