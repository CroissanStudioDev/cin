import { Command } from "commander";
import { globalConfigExists, removeSshKey } from "../../lib/config.js";
import { logger } from "../../utils/logger.js";

export const removeCommand = new Command("remove")
  .alias("rm")
  .description("Remove an SSH key")
  .argument("<name>", "Key name")
  .action((name) => {
    if (!globalConfigExists()) {
      logger.error("Global config not found. Run 'cin init --global' first.");
      process.exit(1);
    }

    try {
      removeSshKey(name);
      logger.success(`Removed SSH key '${name}'`);
    } catch (error) {
      logger.error(error.message);
      process.exit(1);
    }
  });
