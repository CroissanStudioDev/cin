import chalk from "chalk";
import { Command } from "commander";
import { getTasks } from "../../lib/hooks.js";
import { logger } from "../../utils/logger.js";

export const listCommand = new Command("list")
  .alias("ls")
  .description("List available tasks")
  .action(() => {
    const tasks = getTasks();
    const taskNames = Object.keys(tasks);

    if (taskNames.length === 0) {
      logger.info("No tasks configured");
      console.log(
        chalk.gray("\n  Define tasks in .cin/hooks.yaml under 'tasks:'")
      );
      console.log(chalk.gray("  Example:"));
      console.log(chalk.gray("    tasks:"));
      console.log(chalk.gray("      migrate:"));
      console.log(chalk.gray('        description: "Run database migrations"'));
      console.log(chalk.gray('        run: "docker exec api npm run migrate"'));
      console.log();
      return;
    }

    console.log(chalk.bold("\nAvailable tasks:\n"));

    for (const name of taskNames.sort()) {
      const task = tasks[name];
      const desc = task.description || chalk.gray("No description");
      const flags: string[] = [];

      if (task.sudo) {
        flags.push(chalk.red("sudo"));
      }
      if (task.confirm) {
        flags.push(chalk.yellow("confirm"));
      }
      if (task.interactive) {
        flags.push(chalk.blue("interactive"));
      }

      const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";

      console.log(`  ${chalk.cyan(name)}${flagStr}`);
      console.log(`    ${desc}`);
    }

    console.log();
    console.log(chalk.gray("  Run with: cin run <task>"));
    console.log(chalk.gray("  Options:  --sudo, --dry-run, --yes"));
    console.log();
  });
