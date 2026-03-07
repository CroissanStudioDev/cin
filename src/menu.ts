import chalk from "chalk";
import inquirer from "inquirer";
import {
  getRepositories,
  globalConfigExists,
  projectConfigExists,
  readProjectConfig,
} from "./lib/config.js";

interface MenuChoice {
  disabled?: boolean | string;
  name: string;
  value: string;
}

function getProjectStatus(): string {
  if (!projectConfigExists()) {
    return chalk.yellow("not initialized");
  }
  const config = readProjectConfig();
  return chalk.green(config?.project?.name ?? "unnamed");
}

function getRepoCount(): number {
  if (!projectConfigExists()) {
    return 0;
  }
  return getRepositories().length;
}

function printHeader(): void {
  console.clear();
  console.log();
  console.log(chalk.bold.cyan("  ╭─────────────────────────────────────╮"));
  console.log(
    chalk.bold.cyan("  │") +
      chalk.bold("           CIN CLI v0.1.0           ") +
      chalk.bold.cyan("│")
  );
  console.log(
    chalk.bold.cyan("  │") +
      chalk.gray("   Airgapped Deployment Tool        ") +
      chalk.bold.cyan("│")
  );
  console.log(chalk.bold.cyan("  ╰─────────────────────────────────────╯"));
  console.log();
  console.log(chalk.gray(`  Project: ${getProjectStatus()}`));
  console.log(chalk.gray(`  Repos:   ${getRepoCount()}`));
  console.log();
}

function getMainMenuChoices(): MenuChoice[] {
  const hasProject = projectConfigExists();
  const hasGlobal = globalConfigExists();
  const hasRepos = getRepoCount() > 0;

  return [
    {
      name: `${chalk.green("●")} Status           ${chalk.gray("Show project status")}`,
      value: "status",
      disabled: !hasProject && "Initialize project first",
    },
    new inquirer.Separator(chalk.gray("─── Setup ───")),
    {
      name: `${chalk.blue("◆")} Init             ${chalk.gray("Initialize project")}`,
      value: "init",
      disabled: hasProject && "Already initialized",
    },
    {
      name: `${chalk.blue("◆")} Manage repos     ${chalk.gray("Add/remove repositories")}`,
      value: "repo",
      disabled: !hasProject && "Initialize project first",
    },
    {
      name: `${chalk.blue("◆")} Manage SSH keys  ${chalk.gray("Add/remove SSH keys")}`,
      value: "key",
      disabled: !hasGlobal && "Initialize global config first",
    },
    new inquirer.Separator(chalk.gray("─── Workflow ───")),
    {
      name: `${chalk.yellow("▶")} Pull             ${chalk.gray("Fetch code from repos")}`,
      value: "pull",
      disabled: !hasRepos && "Add repositories first",
    },
    {
      name: `${chalk.yellow("▶")} Build            ${chalk.gray("Build Docker images")}`,
      value: "build",
      disabled: !hasRepos && "Add repositories first",
    },
    {
      name: `${chalk.yellow("▶")} Pack             ${chalk.gray("Create offline package")}`,
      value: "pack",
      disabled: !hasRepos && "Add repositories first",
    },
    new inquirer.Separator(chalk.gray("─── Deploy ───")),
    {
      name: `${chalk.magenta("★")} Deploy           ${chalk.gray("Deploy package to target")}`,
      value: "deploy",
    },
    {
      name: `${chalk.magenta("★")} Verify           ${chalk.gray("Verify package integrity")}`,
      value: "verify",
    },
    {
      name: `${chalk.magenta("★")} Rollback         ${chalk.gray("Restore previous version")}`,
      value: "rollback",
    },
    new inquirer.Separator(),
    {
      name: `${chalk.red("×")} Exit`,
      value: "exit",
    },
  ];
}

async function handleRepoMenu(): Promise<void> {
  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "Repositories:",
      choices: [
        { name: "List repositories", value: "list" },
        { name: "Add repository", value: "add" },
        { name: "Remove repository", value: "remove" },
        new inquirer.Separator(),
        { name: "← Back", value: "back" },
      ],
    },
  ]);

  if (action === "back") {
    return;
  }

  if (action === "list") {
    const { listCommand } = await import("./commands/repo/list.js");
    await listCommand.parseAsync([], { from: "user" });
  } else if (action === "add") {
    const { url } = await inquirer.prompt([
      { type: "input", name: "url", message: "Repository URL:" },
    ]);
    if (url) {
      const { addCommand } = await import("./commands/repo/add.js");
      await addCommand.parseAsync([url], { from: "user" });
    }
  } else if (action === "remove") {
    const repos = getRepositories();
    if (repos.length === 0) {
      console.log(chalk.yellow("No repositories to remove"));
      return;
    }
    const { name } = await inquirer.prompt([
      {
        type: "list",
        name: "name",
        message: "Select repository to remove:",
        choices: repos.map((r) => r.name),
      },
    ]);
    const { removeCommand } = await import("./commands/repo/remove.js");
    await removeCommand.parseAsync([name], { from: "user" });
  }
}

async function handleKeyMenu(): Promise<void> {
  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "SSH Keys:",
      choices: [
        { name: "List keys", value: "list" },
        { name: "Add key", value: "add" },
        { name: "Remove key", value: "remove" },
        new inquirer.Separator(),
        { name: "← Back", value: "back" },
      ],
    },
  ]);

  if (action === "back") {
    return;
  }

  if (action === "list") {
    const { listCommand } = await import("./commands/key/list.js");
    await listCommand.parseAsync([], { from: "user" });
  } else if (action === "add") {
    const answers = await inquirer.prompt([
      { type: "input", name: "name", message: "Key name:" },
      { type: "input", name: "path", message: "Path to key file:" },
    ]);
    if (answers.name && answers.path) {
      const { addCommand } = await import("./commands/key/add.js");
      await addCommand.parseAsync([answers.name, answers.path], {
        from: "user",
      });
    }
  } else if (action === "remove") {
    const { getSshKeys } = await import("./lib/config.js");
    const keys = getSshKeys();
    const keyNames = Object.keys(keys);
    if (keyNames.length === 0) {
      console.log(chalk.yellow("No keys to remove"));
      return;
    }
    const { name } = await inquirer.prompt([
      {
        type: "list",
        name: "name",
        message: "Select key to remove:",
        choices: keyNames,
      },
    ]);
    const { removeCommand } = await import("./commands/key/remove.js");
    await removeCommand.parseAsync([name], { from: "user" });
  }
}

async function handleDeploy(): Promise<void> {
  const { packagePath } = await inquirer.prompt([
    {
      type: "input",
      name: "packagePath",
      message: "Path to package (.tar.gz):",
    },
  ]);

  if (!packagePath) {
    return;
  }

  const { target } = await inquirer.prompt([
    {
      type: "input",
      name: "target",
      message: "Target directory:",
      default: "/opt/app",
    },
  ]);

  const { deployCommand } = await import("./commands/deploy.js");
  await deployCommand.parseAsync([packagePath, "-t", target], { from: "user" });
}

async function handleVerify(): Promise<void> {
  const { packagePath } = await inquirer.prompt([
    {
      type: "input",
      name: "packagePath",
      message: "Path to package (.tar.gz):",
    },
  ]);

  if (!packagePath) {
    return;
  }

  const { verifyCommand } = await import("./commands/verify.js");
  await verifyCommand.parseAsync([packagePath], { from: "user" });
}

async function handleRollback(): Promise<void> {
  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "Rollback:",
      choices: [
        { name: "List versions", value: "list" },
        { name: "Rollback to previous", value: "rollback" },
        { name: "Rollback to specific version", value: "specific" },
        new inquirer.Separator(),
        { name: "← Back", value: "back" },
      ],
    },
  ]);

  if (action === "back") {
    return;
  }

  const { rollbackCommand } = await import("./commands/rollback.js");

  if (action === "list") {
    await rollbackCommand.parseAsync(["--list"], { from: "user" });
  } else if (action === "rollback") {
    await rollbackCommand.parseAsync([], { from: "user" });
  } else if (action === "specific") {
    const { version } = await inquirer.prompt([
      { type: "input", name: "version", message: "Version name:" },
    ]);
    if (version) {
      await rollbackCommand.parseAsync(["--to", version], { from: "user" });
    }
  }
}

export async function runInteractiveMenu(): Promise<void> {
  while (true) {
    printHeader();

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: getMainMenuChoices(),
        pageSize: 15,
      },
    ]);

    if (action === "exit") {
      console.log(chalk.gray("\n  Goodbye!\n"));
      break;
    }

    console.log();

    try {
      switch (action) {
        case "status": {
          const { statusCommand } = await import("./commands/status.js");
          await statusCommand.parseAsync([], { from: "user" });
          break;
        }
        case "init": {
          const { initCommand } = await import("./commands/init.js");
          await initCommand.parseAsync([], { from: "user" });
          break;
        }
        case "repo":
          await handleRepoMenu();
          break;
        case "key":
          await handleKeyMenu();
          break;
        case "pull": {
          const { pullCommand } = await import("./commands/pull.js");
          await pullCommand.parseAsync([], { from: "user" });
          break;
        }
        case "build": {
          const { buildCommand } = await import("./commands/build.js");
          await buildCommand.parseAsync([], { from: "user" });
          break;
        }
        case "pack": {
          const { packCommand } = await import("./commands/pack.js");
          await packCommand.parseAsync([], { from: "user" });
          break;
        }
        case "deploy":
          await handleDeploy();
          break;
        case "verify":
          await handleVerify();
          break;
        case "rollback":
          await handleRollback();
          break;
        default:
          break;
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
    }

    // Pause before returning to menu
    await inquirer.prompt([
      {
        type: "input",
        name: "continue",
        message: chalk.gray("Press Enter to continue..."),
      },
    ]);
  }
}
