import { existsSync } from "node:fs";
import { extname } from "node:path";
import { Command } from "commander";
import {
  getProjectName,
  importFromEnv,
  importFromYaml,
  loadSecrets,
  saveSecrets,
} from "../../lib/secrets.js";
import { formatPath, logger } from "../../utils/logger.js";

export const importCommand = new Command("import")
  .description("Import secrets from file (.env or .yaml)")
  .argument("<file>", "Path to secrets file")
  .option("-m, --merge", "Merge with existing secrets instead of replacing")
  .action((file: string, options: { merge?: boolean }) => {
    if (!existsSync(file)) {
      logger.error(`File not found: ${file}`);
      process.exit(1);
    }

    const projectName = getProjectName();
    const ext = extname(file).toLowerCase();

    let imported: Record<string, string>;

    try {
      if (ext === ".env" || file.endsWith(".env")) {
        imported = importFromEnv(file);
      } else if (ext === ".yaml" || ext === ".yml") {
        imported = importFromYaml(file);
      } else {
        // Try to auto-detect
        try {
          imported = importFromYaml(file);
        } catch {
          imported = importFromEnv(file);
        }
      }
    } catch (error) {
      logger.error(`Failed to parse file: ${(error as Error).message}`);
      process.exit(1);
    }

    const importedCount = Object.keys(imported).length;

    if (importedCount === 0) {
      logger.warn("No secrets found in file");
      return;
    }

    let finalSecrets: Record<string, string>;

    if (options.merge) {
      const existing = loadSecrets(projectName);
      finalSecrets = { ...existing, ...imported };
      logger.info(`Merging ${importedCount} secrets with existing`);
    } else {
      finalSecrets = imported;
    }

    saveSecrets(finalSecrets, projectName);

    logger.success(
      `Imported ${importedCount} secret(s) from ${formatPath(file)}`
    );

    console.log();
    logger.info("Imported secrets:");
    for (const key of Object.keys(imported)) {
      console.log(`  • ${key}`);
    }
  });
