import { writeFileSync } from "node:fs";
import { Command } from "commander";
import {
  exportToEnv,
  exportToYaml,
  getProjectName,
  loadSecrets,
  secretsExist,
} from "../../lib/secrets.js";
import { EXIT_CODES } from "../../utils/exit-codes.js";
import { formatPath, logger } from "../../utils/logger.js";

type ExportFormat = "env" | "yaml";

export const exportCommand = new Command("export")
  .description("Export secrets to file (for backup)")
  .option("-f, --format <format>", "Output format: env or yaml", "env")
  .option("-o, --output <file>", "Output file path")
  .action((options: { format: ExportFormat; output?: string }) => {
    const projectName = getProjectName();

    if (!secretsExist(projectName)) {
      logger.error(`No secrets configured for: ${projectName}`);
      process.exit(EXIT_CODES.FILE_ERROR);
    }

    const secrets = loadSecrets(projectName);
    const secretCount = Object.keys(secrets).length;

    if (secretCount === 0) {
      logger.error("No secrets to export");
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    let content: string;
    let defaultExt: string;

    if (options.format === "yaml") {
      content = exportToYaml(secrets);
      defaultExt = ".yaml";
    } else {
      content = exportToEnv(secrets);
      defaultExt = ".env";
    }

    if (options.output) {
      writeFileSync(options.output, content, { mode: 0o600 });
      logger.success(
        `Exported ${secretCount} secret(s) to ${formatPath(options.output)}`
      );
    } else {
      // Print to stdout
      console.log();
      console.log(content);
      logger.info(`Exported ${secretCount} secret(s) to stdout`);
      console.log();
      logger.warn(
        `To save to file, use: cin secrets export -o secrets${defaultExt}`
      );
    }
  });
