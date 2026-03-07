import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import inquirer from "inquirer";
import {
  checkMissingSecrets,
  detectRequiredSecrets,
  getProjectName,
  loadSecrets,
  SECRET_NAME_REGEX,
  type SecretsData,
  saveSecrets,
} from "../../lib/secrets.js";
import { logger } from "../../utils/logger.js";

function findRequiredSecrets(): string[] {
  const composePaths = [
    join(process.cwd(), "docker-compose.yml"),
    join(process.cwd(), "docker-compose.yaml"),
    join(process.cwd(), ".cin", "docker-compose.yml"),
  ];

  for (const path of composePaths) {
    if (existsSync(path)) {
      const secrets = detectRequiredSecrets(path);
      if (secrets.length > 0) {
        logger.info(
          `Found ${secrets.length} required secrets in docker-compose.yml`
        );
        return secrets;
      }
    }
  }
  return [];
}

async function determineSecretsToSetup(
  options: { force?: boolean },
  existingKeys: string[],
  requiredSecrets: string[],
  projectName: string
): Promise<string[] | null> {
  if (options.force) {
    return [...new Set([...existingKeys, ...requiredSecrets])];
  }

  if (requiredSecrets.length > 0) {
    const { missing } = checkMissingSecrets(requiredSecrets, projectName);
    return missing;
  }

  const { addNew } = await inquirer.prompt([
    {
      type: "confirm",
      name: "addNew",
      message: "No required secrets detected. Add secrets manually?",
      default: true,
    },
  ]);

  return addNew ? [] : null;
}

function showExistingSecrets(
  existingKeys: string[],
  force: boolean | undefined
): void {
  if (existingKeys.length > 0 && !force) {
    console.log();
    logger.info("Already configured secrets:");
    for (const key of existingKeys) {
      console.log(`  ✓ ${key}`);
    }
    console.log();
  }
}

async function configureSecrets(
  secretsToSetup: string[],
  existingSecrets: SecretsData
): Promise<SecretsData> {
  const secrets: SecretsData = { ...existingSecrets };

  if (secretsToSetup.length > 0) {
    console.log();
    logger.info("Secrets to configure:");
    for (const key of secretsToSetup) {
      console.log(`  • ${key}`);
    }
    console.log();

    for (const key of secretsToSetup) {
      const currentValue = existingSecrets[key];
      const hasValue = currentValue !== undefined && currentValue !== "";

      const { value } = await inquirer.prompt([
        {
          type: "password",
          name: "value",
          message: `${key}${hasValue ? " (press Enter to keep current)" : ""}:`,
          mask: "*",
        },
      ]);

      if (value) {
        secrets[key] = value;
      } else if (hasValue) {
        secrets[key] = currentValue;
      }
    }
  }

  return secrets;
}

async function addCustomSecrets(secrets: SecretsData): Promise<SecretsData> {
  let addMore = true;

  while (addMore) {
    const { wantMore } = await inquirer.prompt([
      {
        type: "confirm",
        name: "wantMore",
        message: "Add another secret?",
        default: false,
      },
    ]);

    if (!wantMore) {
      addMore = false;
      continue;
    }

    const { key, value } = await inquirer.prompt([
      {
        type: "input",
        name: "key",
        message: "Secret name (e.g., API_KEY):",
        validate: (input: string) =>
          SECRET_NAME_REGEX.test(input) || "Use UPPER_SNAKE_CASE format",
      },
      {
        type: "password",
        name: "value",
        message: "Secret value:",
        mask: "*",
      },
    ]);

    if (key && value) {
      secrets[key] = value;
    }
  }

  return secrets;
}

export const setupCommand = new Command("setup")
  .description("Interactive setup for secrets")
  .option("-f, --force", "Reconfigure all secrets, not just missing ones")
  .action(async (options: { force?: boolean }) => {
    const projectName = getProjectName();
    logger.info(`Setting up secrets for: ${projectName}`);

    const requiredSecrets = findRequiredSecrets();
    const existingSecrets = loadSecrets(projectName);
    const existingKeys = Object.keys(existingSecrets);

    const secretsToSetup = await determineSecretsToSetup(
      options,
      existingKeys,
      requiredSecrets,
      projectName
    );

    if (secretsToSetup === null) {
      return;
    }

    showExistingSecrets(existingKeys, options.force);

    let secrets = await configureSecrets(secretsToSetup, existingSecrets);
    secrets = await addCustomSecrets(secrets);

    const secretCount = Object.keys(secrets).length;
    if (secretCount > 0) {
      saveSecrets(secrets, projectName);
      logger.success(`Saved ${secretCount} secret(s) for ${projectName}`);
    } else {
      logger.warn("No secrets configured");
    }
  });
