import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Command } from "commander";
import {
  addSshKey,
  copyKeyToProject,
  globalConfigExists,
  projectConfigExists,
} from "../../lib/config.js";
import { formatPath, logger } from "../../utils/logger.js";

interface AddOptions {
  project?: boolean;
}

export const addCommand = new Command("add")
  .description("Add an SSH key")
  .argument("<name>", "Key name (for reference)")
  .argument("<path>", "Path to SSH key file")
  .option("-p, --project", "Copy key to project (.cin/keys/)")
  .action((name: string, keyPath: string, options: AddOptions) => {
    const resolvedPath = keyPath.startsWith("~")
      ? keyPath.replace("~", homedir())
      : resolve(keyPath);

    if (!existsSync(resolvedPath)) {
      logger.error(`SSH key file not found: ${resolvedPath}`);
      process.exit(1);
    }

    try {
      if (options.project) {
        // Copy to project directory
        if (!projectConfigExists()) {
          logger.error("Project not initialized. Run 'cin init' first.");
          process.exit(1);
        }

        const keyFileName = name.includes(".") ? name : `${name}.key`;
        const destPath = copyKeyToProject(resolvedPath, keyFileName);
        logger.success(`Copied key to ${formatPath(destPath)}`);
        logger.info(`Use in repo config: ssh_key: "${keyFileName}"`);
      } else {
        // Add to global config
        if (!globalConfigExists()) {
          logger.error(
            "Global config not found. Run 'cin init --global' first."
          );
          process.exit(1);
        }

        // Store with ~ for portability
        const storedPath = resolvedPath.startsWith(homedir())
          ? resolvedPath.replace(homedir(), "~")
          : resolvedPath;

        addSshKey(name, storedPath);
        logger.success(`Added SSH key '${name}' -> ${storedPath}`);
      }
    } catch (error) {
      logger.error((error as Error).message);
      process.exit(1);
    }
  });
