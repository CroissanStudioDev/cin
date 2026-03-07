import { existsSync, readdirSync } from "node:fs";
import chalk from "chalk";
import { Command } from "commander";
import {
  getProjectKeysDir,
  getSshKeys,
  globalConfigExists,
  projectConfigExists,
} from "../../lib/config.js";

function printGlobalKeys(): boolean {
  if (!globalConfigExists()) {
    return false;
  }

  const keys = getSshKeys();
  const keyNames = Object.keys(keys);

  if (keyNames.length === 0) {
    return false;
  }

  console.log(chalk.bold("\nGlobal SSH Keys:\n"));

  for (const name of keyNames) {
    const path = keys[name];
    const expanded = path.replace("~", process.env.HOME ?? "");
    const status = existsSync(expanded) ? chalk.green("✓") : chalk.red("✗");
    console.log(`  ${status} ${chalk.yellow(name)}`);
    console.log(chalk.gray(`      ${path}`));
  }

  return true;
}

function printProjectKeys(): boolean {
  if (!projectConfigExists()) {
    return false;
  }

  const keysDir = getProjectKeysDir();

  if (!existsSync(keysDir)) {
    return false;
  }

  const files = readdirSync(keysDir).filter(
    (f) => !f.startsWith(".") && f !== ".gitignore"
  );

  if (files.length === 0) {
    return false;
  }

  console.log(chalk.bold("\nProject SSH Keys (.cin/keys/):\n"));

  for (const file of files) {
    console.log(`  ${chalk.green("✓")} ${chalk.cyan(file)}`);
  }

  return true;
}

function printNoKeysHelp(): void {
  console.log(chalk.gray("\nNo SSH keys configured."));
  console.log(chalk.gray("  Add global:  cin key add <name> <path>"));
  console.log(chalk.gray("  Add project: cin key add <name> <path> --project"));
}

export const listCommand = new Command("list")
  .alias("ls")
  .description("List all SSH keys")
  .action(() => {
    const hasGlobal = printGlobalKeys();
    const hasProject = printProjectKeys();

    if (!(hasGlobal || hasProject)) {
      printNoKeysHelp();
    }

    console.log();
  });
