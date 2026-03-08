import { Command } from "commander";
import { globalConfigExists, removeSshKey } from "../../lib/config.js";
import { EXIT_CODES } from "../../utils/exit-codes.js";
import { logger } from "../../utils/logger.js";

export const removeCommand = new Command("remove")
  .alias("rm")
  .description("Remove an SSH key")
  .argument("<name>", "Key name")
  .action((name: string) => {
    if (!globalConfigExists()) {
      logger.error("Global config not found. Run 'cin init --global' first.");
      process.exit(EXIT_CODES.CONFIG_ERROR);
    }

    try {
      removeSshKey(name);
      logger.success(`Removed SSH key '${name}'`);
    } catch (error) {
      logger.error((error as Error).message);
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });
