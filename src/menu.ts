import chalk from "chalk";
import inquirer from "inquirer";
import { getLocale, initLocale, setLocale, t } from "./i18n/index.js";
import {
  getRepositories,
  globalConfigExists,
  projectConfigExists,
  readProjectConfig,
  setLanguage,
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

interface VersionInfo {
  current: string | null;
  hasUpdate: boolean;
  latest: string | null;
}

let cachedVersionInfo: VersionInfo | null = null;
let versionCheckPromise: Promise<VersionInfo> | null = null;

async function checkVersionStatus(): Promise<VersionInfo> {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { simpleGit } = await import("simple-git");
  const { resolveSshKey } = await import("./lib/config.js");

  const defaultInfo: VersionInfo = {
    current: null,
    latest: null,
    hasUpdate: false,
  };

  if (!projectConfigExists()) {
    return defaultInfo;
  }

  const repos = getRepositories();
  if (repos.length === 0) {
    return defaultInfo;
  }

  const repo = repos[0];
  const repoPath = join(process.cwd(), ".cin", "repos", repo.name);

  if (!existsSync(repoPath)) {
    return defaultInfo;
  }

  try {
    const git = simpleGit(repoPath);

    const sshKey = repo.ssh_key ? resolveSshKey(repo.ssh_key) : null;
    if (sshKey) {
      git.env(
        "GIT_SSH_COMMAND",
        `ssh -i ${sshKey} -o StrictHostKeyChecking=no`
      );
    }

    // Get current HEAD commit
    const currentCommit = await git.revparse(["HEAD"]);

    // Get tag at HEAD (if any)
    const currentTags = await git.tag(["--points-at", "HEAD"]);
    const currentTag = currentTags.trim().split("\n")[0] || null;

    // Get latest tag
    const allTags = await git.tags(["--sort=-version:refname"]);
    const latestTag = allTags.all[0] || null;

    if (!latestTag) {
      return { current: currentTag, latest: null, hasUpdate: false };
    }

    // Dereference annotated tag to commit SHA
    const latestCommit = await git.revparse([`${latestTag}^{}`]);
    const hasUpdate = currentCommit.trim() !== latestCommit.trim();

    return {
      current: currentTag ?? currentCommit.trim().substring(0, 7),
      latest: latestTag,
      hasUpdate,
    };
  } catch {
    return defaultInfo;
  }
}

function startVersionCheck(): void {
  if (!versionCheckPromise) {
    versionCheckPromise = checkVersionStatus().then((info) => {
      cachedVersionInfo = info;
      return info;
    });
  }
}

function getVersionDisplay(): string {
  if (!cachedVersionInfo) {
    return "";
  }

  const { current, latest, hasUpdate } = cachedVersionInfo;

  if (!current) {
    return "";
  }

  if (hasUpdate && latest) {
    return `${chalk.cyan(current)} ${chalk.yellow("→")} ${chalk.green(latest)}`;
  }

  return chalk.green(current);
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

  const versionDisplay = getVersionDisplay();
  if (versionDisplay) {
    console.log(chalk.gray(`  ${i.version ?? "Version"}:  ${versionDisplay}`));
  }

  console.log();
}

function formatMenuItem(icon: string, label: string, desc: string): string {
  return `${icon} ${padRight(label, 16)} ${chalk.gray(desc)}`;
}

function getMainMenuChoices(): (MenuChoice | inquirer.Separator)[] {
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
    {
      name: formatMenuItem(
        chalk.blue("◆"),
        i.manageSecrets,
        i.manageSecretsDesc
      ),
      value: "secrets",
      disabled: !hasProject && i.initFirst,
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
    {
      name: formatMenuItem(chalk.magenta("★"), i.logs, i.logsDesc),
      value: "logs",
    },
    {
      name: formatMenuItem(chalk.magenta("★"), i.tasks, i.tasksDesc),
      value: "tasks",
    },
    new inquirer.Separator(chalk.gray(`─── ${i.sectionSettings} ───`)),
    {
      name: formatMenuItem(chalk.gray("⚙"), i.language, i.languageDesc),
      value: "language",
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

async function handleSecretsMenu(): Promise<void> {
  const i = t().secrets;
  const m = t().menu;

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: `${i.title}:`,
      choices: [
        { name: i.setup, value: "setup" },
        { name: i.list, value: "list" },
        { name: i.check, value: "check" },
        { name: i.import, value: "import" },
        { name: i.export, value: "export" },
        new inquirer.Separator(),
        { name: m.back, value: "back" },
      ],
    },
  ]);

  if (action === "back") {
    return;
  }

  if (action === "setup") {
    const { setupCommand } = await import("./commands/secrets/setup.js");
    await setupCommand.parseAsync([], { from: "user" });
  } else if (action === "list") {
    const { listCommand } = await import("./commands/secrets/list.js");
    await listCommand.parseAsync(["--show"], { from: "user" });
  } else if (action === "check") {
    const { checkCommand } = await import("./commands/secrets/check.js");
    await checkCommand.parseAsync([], { from: "user" });
  } else if (action === "import") {
    const { file } = await inquirer.prompt([
      { type: "input", name: "file", message: i.filePrompt },
    ]);
    if (file) {
      const { importCommand } = await import("./commands/secrets/import.js");
      await importCommand.parseAsync([file, "--merge"], { from: "user" });
    }
  } else if (action === "export") {
    const { exportCommand } = await import("./commands/secrets/export.js");
    await exportCommand.parseAsync([], { from: "user" });
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

async function handleLogsMenu(): Promise<void> {
  const i = t().logs;
  const m = t().menu;

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: `${i.title}:`,
      choices: [
        { name: i.viewLive, value: "live" },
        { name: i.collect, value: "collect" },
        new inquirer.Separator(),
        { name: m.back, value: "back" },
      ],
    },
  ]);

  if (action === "back") {
    return;
  }

  if (action === "live") {
    const { target } = await inquirer.prompt([
      {
        type: "input",
        name: "target",
        message: i.targetPrompt,
        default: "/opt/app",
      },
    ]);
    const { logsCommand } = await import("./commands/logs/index.js");
    await logsCommand.parseAsync(["-f", "-t", target], { from: "user" });
  } else if (action === "collect") {
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "days",
        message: i.daysPrompt,
        default: "7",
      },
      {
        type: "input",
        name: "target",
        message: i.targetPrompt,
        default: "/opt/app",
      },
    ]);
    const { collectCommand } = await import("./commands/logs/collect.js");
    await collectCommand.parseAsync(
      ["-d", answers.days, "-t", answers.target],
      { from: "user" }
    );
  }
}

async function handleTasksMenu(): Promise<void> {
  const i = t().tasks;
  const m = t().menu;

  const { getTasks } = await import("./lib/hooks.js");
  const tasks = getTasks();
  const taskNames = Object.keys(tasks);

  if (taskNames.length === 0) {
    console.log(chalk.yellow(i.noTasks));
    return;
  }

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: `${i.title}:`,
      choices: [
        { name: i.list, value: "list" },
        { name: i.run, value: "run" },
        new inquirer.Separator(),
        { name: m.back, value: "back" },
      ],
    },
  ]);

  if (action === "back") {
    return;
  }

  if (action === "list") {
    const { listCommand } = await import("./commands/tasks/list.js");
    await listCommand.parseAsync([], { from: "user" });
  } else if (action === "run") {
    const { taskName } = await inquirer.prompt([
      {
        type: "list",
        name: "taskName",
        message: i.taskPrompt,
        choices: taskNames.map((name) => ({
          name: `${name} - ${tasks[name].description || ""}`,
          value: name,
        })),
      },
    ]);

    const { runCommand } = await import("./commands/run.js");
    await runCommand.parseAsync([taskName], { from: "user" });
  }
}

async function handleLanguage(): Promise<void> {
  const m = t().menu;
  const currentLang = getLocale();

  const { lang } = await inquirer.prompt([
    {
      type: "list",
      name: "lang",
      message: m.selectLanguage,
      choices: [
        { name: "English", value: "en", disabled: currentLang === "en" && "✓" },
        { name: "Русский", value: "ru", disabled: currentLang === "ru" && "✓" },
        new inquirer.Separator(),
        { name: m.back, value: "back" },
      ],
    },
  ]);

  if (lang === "back") {
    return;
  }

  setLanguage(lang);
  setLocale(lang);
  initLocale();
  console.log(chalk.green(`✓ ${t().menu.languageSaved}`));
}

export async function runInteractiveMenu(): Promise<void> {
  // Check version on first run (await to show in header)
  startVersionCheck();
  if (versionCheckPromise) {
    await versionCheckPromise;
  }

  while (true) {
    const m = t().menu;
    const e = t().errors;

    printHeader();

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: m.whatToDo,
        choices: getMainMenuChoices(),
        pageSize: 16,
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
        case "secrets":
          await handleSecretsMenu();
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
        case "logs":
          await handleLogsMenu();
          break;
        case "tasks":
          await handleTasksMenu();
          break;
        case "language":
          await handleLanguage();
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
