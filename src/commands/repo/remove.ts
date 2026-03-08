import { Command } from "commander";
import { projectConfigExists, removeRepository } from "../../lib/config.js";
import { EXIT_CODES } from "../../utils/exit-codes.js";
import { formatRepo, logger } from "../../utils/logger.js";

export const removeCommand = new Command("remove")
  .alias("rm")
  .description("Remove a repository")
  .argument("<name>", "Repository name")
  .action((name: string) => {
    if (!projectConfigExists()) {
      logger.error("Project not initialized. Run 'cin init' first.");
      process.exit(EXIT_CODES.CONFIG_ERROR);
    }

    try {
      removeRepository(name);
      logger.success(`Removed repository ${formatRepo(name)}`);
    } catch (error) {
      logger.error((error as Error).message);
      process.exit(EXIT_CODES.FILE_ERROR);
    }
  });
