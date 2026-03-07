import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Command } from "commander";
import { addSshKey, globalConfigExists } from "../../lib/config.js";
import { logger } from "../../utils/logger.js";

export const addCommand = new Command("add")
  .description("Add an SSH key")
  .argument("<name>", "Key name (for reference)")
  .argument("<path>", "Path to SSH key file")
  .action((name, keyPath) => {
    if (!globalConfigExists()) {
      logger.error("Global config not found. Run 'cin init --global' first.");
      process.exit(1);
    }

    const resolvedPath = keyPath.startsWith("~")
      ? keyPath.replace("~", homedir())
      : resolve(keyPath);

    if (!existsSync(resolvedPath)) {
      logger.error(`SSH key file not found: ${resolvedPath}`);
      process.exit(1);
    }

    // Store with ~ for portability
    const storedPath = resolvedPath.startsWith(homedir())
      ? resolvedPath.replace(homedir(), "~")
      : resolvedPath;

    try {
      addSshKey(name, storedPath);
      logger.success(`Added SSH key '${name}' -> ${storedPath}`);
    } catch (error) {
      logger.error(error.message);
      process.exit(1);
    }
  });
