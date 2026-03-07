import { Command } from "commander";
import { projectConfigExists, removeRepository } from "../../lib/config.js";
import { formatRepo, logger } from "../../utils/logger.js";

export const removeCommand = new Command("remove")
  .alias("rm")
  .description("Remove a repository")
  .argument("<name>", "Repository name")
  .action((name) => {
    if (!projectConfigExists()) {
      logger.error("Project not initialized. Run 'cin init' first.");
      process.exit(1);
    }

    try {
      removeRepository(name);
      logger.success(`Removed repository ${formatRepo(name)}`);
    } catch (error) {
      logger.error(error.message);
      process.exit(1);
    }
  });
