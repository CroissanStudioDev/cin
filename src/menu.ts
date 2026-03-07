import chalk from "chalk";
import inquirer from "inquirer";
import { t } from "./i18n/index.js";
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
    return chalk.yellow(t().menu.notInitialized);
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

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

function padRight(str: string, len: number): string {
  const visibleLength = str.replace(ANSI_REGEX, "").length;
  return str + " ".repeat(Math.max(0, len - visibleLength));
}

function printHeader(): void {
  const i = t().menu;
  console.clear();
  console.log();
  console.log(chalk.bold.cyan("  ╭─────────────────────────────────────╮"));
  console.log(
    chalk.bold.cyan("  │") +
      chalk.bold(`           ${i.title}           `) +
      chalk.bold.cyan("│")
  );
  console.log(
    chalk.bold.cyan("  │") +
      chalk.gray(`   ${padRight(i.subtitle, 32)}`) +
      chalk.bold.cyan("│")
  );
  console.log(chalk.bold.cyan("  ╰─────────────────────────────────────╯"));
  console.log();
  console.log(chalk.gray(`  ${i.project}: ${getProjectStatus()}`));
  console.log(chalk.gray(`  ${i.repos}:   ${getRepoCount()}`));
  console.log();
}

function formatMenuItem(icon: string, label: string, desc: string): string {
  return `${icon} ${padRight(label, 16)} ${chalk.gray(desc)}`;
}

function getMainMenuChoices(): MenuChoice[] {
  const hasProject = projectConfigExists();
  const hasGlobal = globalConfigExists();
  const hasRepos = getRepoCount() > 0;
  const i = t().menu;

  return [
    {
      name: formatMenuItem(chalk.green("●"), i.status, i.statusDesc),
      value: "status",
      disabled: !hasProject && i.initFirst,
    },
    new inquirer.Separator(chalk.gray(`─── ${i.sectionSetup} ───`)),
    {
      name: formatMenuItem(chalk.blue("◆"), i.init, i.initDesc),
      value: "init",
      disabled: hasProject && i.alreadyInitialized,
    },
    {
      name: formatMenuItem(chalk.blue("◆"), i.manageRepos, i.manageReposDesc),
      value: "repo",
      disabled: !hasProject && i.initFirst,
    },
    {
      name: formatMenuItem(chalk.blue("◆"), i.manageKeys, i.manageKeysDesc),
      value: "key",
      disabled: !hasGlobal && i.initGlobalFirst,
    },
    new inquirer.Separator(chalk.gray(`─── ${i.sectionWorkflow} ───`)),
    {
      name: formatMenuItem(chalk.yellow("▶"), i.pull, i.pullDesc),
      value: "pull",
      disabled: !hasRepos && i.addReposFirst,
    },
    {
      name: formatMenuItem(chalk.yellow("▶"), i.build, i.buildDesc),
      value: "build",
      disabled: !hasRepos && i.addReposFirst,
    },
    {
      name: formatMenuItem(chalk.yellow("▶"), i.pack, i.packDesc),
      value: "pack",
      disabled: !hasRepos && i.addReposFirst,
    },
    new inquirer.Separator(chalk.gray(`─── ${i.sectionDeploy} ───`)),
    {
      name: formatMenuItem(chalk.magenta("★"), i.deploy, i.deployDesc),
      value: "deploy",
    },
    {
      name: formatMenuItem(chalk.magenta("★"), i.verify, i.verifyDesc),
      value: "verify",
    },
    {
      name: formatMenuItem(chalk.magenta("★"), i.rollback, i.rollbackDesc),
      value: "rollback",
    },
    new inquirer.Separator(),
    {
      name: `${chalk.red("×")} ${i.exit}`,
      value: "exit",
    },
  ];
}

async function handleRepoMenu(): Promise<void> {
  const i = t().repo;
  const m = t().menu;

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: `${i.title}:`,
      choices: [
        { name: i.list, value: "list" },
        { name: i.add, value: "add" },
        { name: i.remove, value: "remove" },
        new inquirer.Separator(),
        { name: m.back, value: "back" },
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
      { type: "input", name: "url", message: i.urlPrompt },
    ]);
    if (url) {
      const { addCommand } = await import("./commands/repo/add.js");
      await addCommand.parseAsync([url], { from: "user" });
    }
  } else if (action === "remove") {
    const repos = getRepositories();
    if (repos.length === 0) {
      console.log(chalk.yellow(i.noRepos));
      return;
    }
    const { name } = await inquirer.prompt([
      {
        type: "list",
        name: "name",
        message: i.selectRemove,
        choices: repos.map((r) => r.name),
      },
    ]);
    const { removeCommand } = await import("./commands/repo/remove.js");
    await removeCommand.parseAsync([name], { from: "user" });
  }
}

async function handleKeyMenu(): Promise<void> {
  const i = t().key;
  const m = t().menu;

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: `${i.title}:`,
      choices: [
        { name: i.list, value: "list" },
        { name: i.add, value: "add" },
        { name: i.remove, value: "remove" },
        new inquirer.Separator(),
        { name: m.back, value: "back" },
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
      { type: "input", name: "name", message: i.namePrompt },
      { type: "input", name: "path", message: i.pathPrompt },
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
      console.log(chalk.yellow(i.noKeys));
      return;
    }
    const { name } = await inquirer.prompt([
      {
        type: "list",
        name: "name",
        message: i.selectRemove,
        choices: keyNames,
      },
    ]);
    const { removeCommand } = await import("./commands/key/remove.js");
    await removeCommand.parseAsync([name], { from: "user" });
  }
}

async function handleDeploy(): Promise<void> {
  const i = t().deploy;

  const { packagePath } = await inquirer.prompt([
    {
      type: "input",
      name: "packagePath",
      message: i.packagePrompt,
    },
  ]);

  if (!packagePath) {
    return;
  }

  const { target } = await inquirer.prompt([
    {
      type: "input",
      name: "target",
      message: i.targetPrompt,
      default: "/opt/app",
    },
  ]);

  const { deployCommand } = await import("./commands/deploy.js");
  await deployCommand.parseAsync([packagePath, "-t", target], { from: "user" });
}

async function handleVerify(): Promise<void> {
  const i = t().verify;

  const { packagePath } = await inquirer.prompt([
    {
      type: "input",
      name: "packagePath",
      message: i.packagePrompt,
    },
  ]);

  if (!packagePath) {
    return;
  }

  const { verifyCommand } = await import("./commands/verify.js");
  await verifyCommand.parseAsync([packagePath], { from: "user" });
}

async function handleRollback(): Promise<void> {
  const i = t().rollback;
  const m = t().menu;

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: `${i.title}:`,
      choices: [
        { name: i.listVersions, value: "list" },
        { name: i.rollbackPrevious, value: "rollback" },
        { name: i.rollbackSpecific, value: "specific" },
        new inquirer.Separator(),
        { name: m.back, value: "back" },
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
      { type: "input", name: "version", message: i.versionPrompt },
    ]);
    if (version) {
      await rollbackCommand.parseAsync(["--to", version], { from: "user" });
    }
  }
}

export async function runInteractiveMenu(): Promise<void> {
  const m = t().menu;
  const e = t().errors;

  while (true) {
    printHeader();

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: m.whatToDo,
        choices: getMainMenuChoices(),
        pageSize: 15,
      },
    ]);

    if (action === "exit") {
      console.log(chalk.gray(`\n  ${m.goodbye}\n`));
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
      console.error(chalk.red(`${e.error}: ${(error as Error).message}`));
    }

    // Pause before returning to menu
    await inquirer.prompt([
      {
        type: "input",
        name: "continue",
        message: chalk.gray(m.pressEnter),
      },
    ]);
  }
}
