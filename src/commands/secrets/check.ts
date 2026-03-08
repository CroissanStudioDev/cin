import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import {
  checkMissingSecrets,
  detectRequiredSecrets,
  getProjectName,
} from "../../lib/secrets.js";
import { EXIT_CODES } from "../../utils/exit-codes.js";
import { logger } from "../../utils/logger.js";

export const checkCommand = new Command("check")
  .description("Check if all required secrets are configured")
  .option("-c, --compose <file>", "Path to docker-compose.yml")
  .action((options: { compose?: string }) => {
    const projectName = getProjectName();

    // Find docker-compose.yml
    const composePaths = options.compose
      ? [options.compose]
      : [
          join(process.cwd(), "docker-compose.yml"),
          join(process.cwd(), "docker-compose.yaml"),
          join(process.cwd(), ".cin", "docker-compose.yml"),
        ];

    let composePath: string | null = null;
    for (const path of composePaths) {
      if (existsSync(path)) {
        composePath = path;
        break;
      }
    }

    if (!composePath) {
      logger.warn("No docker-compose.yml found");
      console.log(chalk.gray("\n  Use --compose <file> to specify path"));
      console.log(
        chalk.gray("  Or run 'cin secrets list' to see configured secrets")
      );
      return;
    }

    // Detect required secrets
    const requiredSecrets = detectRequiredSecrets(composePath);

    if (requiredSecrets.length === 0) {
      logger.success("No required secrets detected in docker-compose.yml");
      console.log(
        chalk.gray("\n  All environment variables have default values")
      );
      return;
    }

    // Check which are configured
    const { configured, missing } = checkMissingSecrets(
      requiredSecrets,
      projectName
    );

    console.log(
      chalk.bold(`\nSecrets check for ${chalk.cyan(projectName)}:\n`)
    );

    // Show configured
    if (configured.length > 0) {
      for (const key of configured) {
        console.log(`  ${chalk.green("✓")} ${key}`);
      }
    }

    // Show missing
    if (missing.length > 0) {
      for (const key of missing) {
        console.log(`  ${chalk.red("✗")} ${key} ${chalk.red("[NOT SET]")}`);
      }
    }

    console.log();

    // Summary
    if (missing.length === 0) {
      logger.success(
        `All ${configured.length} required secret(s) are configured`
      );
    } else {
      logger.warn(
        `Missing ${missing.length} of ${requiredSecrets.length} required secret(s)`
      );
      console.log(
        chalk.gray("\n  Run 'cin secrets setup' to configure missing secrets")
      );
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }
  });
