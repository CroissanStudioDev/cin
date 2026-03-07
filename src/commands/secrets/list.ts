import chalk from "chalk";
import { Command } from "commander";
import {
  getProjectName,
  loadSecrets,
  maskValue,
  secretsExist,
} from "../../lib/secrets.js";
import { logger } from "../../utils/logger.js";

export const listCommand = new Command("list")
  .alias("ls")
  .description("List configured secrets (without values)")
  .option("-s, --show", "Show masked values")
  .action((options: { show?: boolean }) => {
    const projectName = getProjectName();

    if (!secretsExist(projectName)) {
      logger.info(`No secrets configured for: ${projectName}`);
      console.log(
        chalk.gray("\n  Run 'cin secrets setup' to configure secrets")
      );
      return;
    }

    const secrets = loadSecrets(projectName);
    const keys = Object.keys(secrets);

    if (keys.length === 0) {
      logger.info(`No secrets configured for: ${projectName}`);
      return;
    }

    console.log(chalk.bold(`\nSecrets for ${chalk.cyan(projectName)}:\n`));

    for (const key of keys.sort()) {
      if (options.show) {
        const masked = maskValue(secrets[key]);
        console.log(
          `  ${chalk.green("✓")} ${chalk.yellow(key)} = ${chalk.gray(masked)}`
        );
      } else {
        console.log(`  ${chalk.green("✓")} ${chalk.yellow(key)}`);
      }
    }

    console.log(chalk.gray(`\n  Total: ${keys.length} secret(s)`));
    console.log();
  });
