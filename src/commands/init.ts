import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import inquirer from "inquirer";
import {
  type GlobalConfig,
  getGlobalConfigPath,
  getProjectConfigPath,
  getProjectKeysDir,
  globalConfigExists,
  initGlobalConfig,
  initProjectConfig,
  type ProjectConfig,
  projectConfigExists,
} from "../lib/config.js";
import { formatPath, logger } from "../utils/logger.js";

const GITIGNORE_CONTENT = `# CIN CLI - DO NOT COMMIT PRIVATE KEYS
*.key
*.pem
id_*
!*.pub
`;

export const initCommand = new Command("init")
  .description("Initialize a new CIN project")
  .option("-g, --global", "Initialize global config only")
  .option("-y, --yes", "Use defaults without prompts")
  .action(async (options: { global?: boolean; yes?: boolean }) => {
    if (options.global) {
      await initGlobal(options.yes);
    } else {
      await initProject(options.yes);
    }
  });

async function initGlobal(useDefaults?: boolean): Promise<void> {
  if (globalConfigExists()) {
    logger.skip(
      `Global config already exists at ${formatPath(getGlobalConfigPath())}`
    );
    return;
  }

  const config: Partial<GlobalConfig> = {};

  if (!useDefaults) {
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "orgName",
        message: "Organization name:",
        default: "",
      },
    ]);
    config.organization = { name: answers.orgName };
  }

  initGlobalConfig(config);
  logger.success(
    `Created global config at ${formatPath(getGlobalConfigPath())}`
  );
}

async function initProject(useDefaults?: boolean): Promise<void> {
  if (projectConfigExists()) {
    logger.skip(
      `Project already initialized at ${formatPath(getProjectConfigPath())}`
    );
    return;
  }

  // Ensure global config exists
  if (!globalConfigExists()) {
    logger.info("Global config not found, creating...");
    await initGlobal(useDefaults);
  }

  let config: Partial<ProjectConfig>;

  if (useDefaults) {
    config = {
      project: {
        name: process.cwd().split("/").pop() ?? "unnamed",
        type: "docker-compose",
      },
    };
  } else {
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "projectName",
        message: "Project name:",
        default: process.cwd().split("/").pop(),
      },
      {
        type: "input",
        name: "vendorName",
        message: "Vendor (studio) name:",
        default: "",
      },
      {
        type: "input",
        name: "vendorContact",
        message: "Vendor contact email:",
        default: "",
      },
    ]);

    config = {
      project: {
        name: answers.projectName,
        type: "docker-compose",
      },
      vendor: {
        name: answers.vendorName,
        contact: answers.vendorContact,
      },
    };
  }

  initProjectConfig(config);
  logger.success(
    `Created project config at ${formatPath(getProjectConfigPath())}`
  );

  // Create keys directory with .gitignore
  const keysDir = getProjectKeysDir();
  if (!existsSync(keysDir)) {
    mkdirSync(keysDir, { recursive: true });
    writeFileSync(join(keysDir, ".gitignore"), GITIGNORE_CONTENT);
    logger.success(`Created keys directory at ${formatPath(keysDir)}`);
  }
}
