import { Command } from "commander";
import { getTask, getTasks, runTask } from "../lib/hooks.js";
import { logger } from "../utils/logger.js";

interface RunOptions {
  dryRun?: boolean;
  env?: string[];
  sudo?: boolean;
  yes?: boolean;
}

function parseEnvOptions(
  envOptions: string[] | undefined
): Record<string, string> {
  const env: Record<string, string> = {};

  if (!envOptions) {
    return env;
  }

  for (const item of envOptions) {
    const eqIndex = item.indexOf("=");
    if (eqIndex > 0) {
      env[item.slice(0, eqIndex)] = item.slice(eqIndex + 1);
    }
  }

  return env;
}

export const runCommand = new Command("run")
  .description("Run a configured task")
  .argument("<task>", "Task name to run")
  .option("--sudo", "Run with sudo")
  .option("--dry-run", "Show what would be executed without running")
  .option("-y, --yes", "Skip confirmation prompts")
  .option("-e, --env <key=value...>", "Set environment variables")
  .action(async (taskName: string, options: RunOptions) => {
    const task = getTask(taskName);

    if (!task) {
      logger.error(`Task "${taskName}" not found`);

      // Suggest similar tasks
      const tasks = getTasks();
      const taskNames = Object.keys(tasks);

      if (taskNames.length > 0) {
        const similar = taskNames.filter(
          (name) =>
            name.includes(taskName) ||
            taskName.includes(name) ||
            name.split(":").some((part) => taskName.includes(part))
        );

        if (similar.length > 0) {
          console.log();
          logger.info("Did you mean:");
          for (const name of similar) {
            console.log(`  cin run ${name}`);
          }
        } else {
          console.log();
          logger.info("Available tasks:");
          for (const name of taskNames.slice(0, 5)) {
            console.log(`  cin run ${name}`);
          }
          if (taskNames.length > 5) {
            console.log(`  ... and ${taskNames.length - 5} more`);
          }
        }
      }

      console.log();
      process.exit(1);
    }

    const envVars = parseEnvOptions(options.env);

    const success = await runTask(taskName, {
      sudo: options.sudo,
      dryRun: options.dryRun,
      skipConfirm: options.yes,
      env: envVars,
    });

    if (!success) {
      process.exit(1);
    }
  });
