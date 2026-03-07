import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { logger, spinner } from "../utils/logger.js";

export type HookType =
  | "pre-deploy"
  | "post-deploy"
  | "pre-rollback"
  | "post-rollback";

export interface HookDefinition {
  continue_on_error?: boolean;
  name: string;
  retries?: number;
  retry_delay?: number;
  run: string;
  timeout?: number;
}

export interface TaskDefinition {
  confirm?: boolean;
  description?: string;
  env?: Record<string, string> | string[];
  interactive?: boolean;
  name?: string;
  retries?: number;
  retry_delay?: number;
  run: string;
  sudo?: boolean;
  timeout?: number;
}

export interface HooksConfig {
  hooks?: {
    "pre-deploy"?: HookDefinition[];
    "post-deploy"?: HookDefinition[];
    "pre-rollback"?: HookDefinition[];
    "post-rollback"?: HookDefinition[];
  };
  tasks?: Record<string, TaskDefinition>;
  version?: number;
}

const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const DEFAULT_RETRY_DELAY = 5000; // 5 seconds

function getHooksConfigPath(cwd = process.cwd()): string {
  return join(cwd, ".cin", "hooks.yaml");
}

export function loadHooksConfig(cwd = process.cwd()): HooksConfig {
  const configPath = getHooksConfigPath(cwd);

  if (!existsSync(configPath)) {
    return { hooks: {}, tasks: {} };
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    return parseYaml(content) as HooksConfig;
  } catch {
    return { hooks: {}, tasks: {} };
  }
}

export function getHooks(
  hookType: HookType,
  cwd = process.cwd()
): HookDefinition[] {
  const config = loadHooksConfig(cwd);
  return config.hooks?.[hookType] ?? [];
}

export function getTasks(cwd = process.cwd()): Record<string, TaskDefinition> {
  const config = loadHooksConfig(cwd);
  return config.tasks ?? {};
}

export function getTask(
  taskName: string,
  cwd = process.cwd()
): TaskDefinition | null {
  const tasks = getTasks(cwd);
  return tasks[taskName] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseEnvArray(
  env: string[] | Record<string, string> | undefined
): Record<string, string> {
  if (!env) {
    return {};
  }

  if (Array.isArray(env)) {
    const result: Record<string, string> = {};
    for (const item of env) {
      const eqIndex = item.indexOf("=");
      if (eqIndex > 0) {
        result[item.slice(0, eqIndex)] = item.slice(eqIndex + 1);
      }
    }
    return result;
  }

  return env;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  interactive?: boolean;
  sudo?: boolean;
  timeout?: number;
}

export function runCommandSync(
  command: string,
  options: RunOptions = {}
): { success: boolean; output: string; error?: string } {
  const { cwd, env, sudo, timeout = DEFAULT_TIMEOUT } = options;

  let finalCommand = command;
  if (sudo) {
    finalCommand = `sudo ${command}`;
  }

  const result = spawnSync("sh", ["-c", finalCommand], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf-8",
    timeout,
    stdio: ["inherit", "pipe", "pipe"],
  });

  if (result.error) {
    return {
      success: false,
      output: "",
      error: result.error.message,
    };
  }

  return {
    success: result.status === 0,
    output: result.stdout || "",
    error: result.stderr || undefined,
  };
}

export function runCommandAsync(
  command: string,
  options: RunOptions = {}
): Promise<{ success: boolean; output: string; error?: string }> {
  const { cwd, env, sudo, interactive, timeout = DEFAULT_TIMEOUT } = options;

  return new Promise((resolve) => {
    let finalCommand = command;
    if (sudo) {
      finalCommand = `sudo ${command}`;
    }

    const proc = spawn("sh", ["-c", finalCommand], {
      cwd,
      env: { ...process.env, ...env },
      stdio: interactive ? "inherit" : ["inherit", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (!interactive) {
      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
        process.stdout.write(data);
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
        process.stderr.write(data);
      });
    }

    const timeoutId = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({
        success: false,
        output: stdout,
        error: `Command timed out after ${timeout}ms`,
      });
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({
        success: code === 0,
        output: stdout,
        error: stderr || undefined,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        output: stdout,
        error: err.message,
      });
    });
  });
}

export async function runHook(
  hook: HookDefinition,
  options: RunOptions = {}
): Promise<boolean> {
  const {
    timeout = DEFAULT_TIMEOUT,
    retries = 0,
    retry_delay = DEFAULT_RETRY_DELAY,
    continue_on_error = false,
  } = hook;

  const maxAttempts = retries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const spin = spinner(`[${hook.name}] Running...`).start();

    const result = await runCommandAsync(hook.run, {
      ...options,
      timeout,
    });

    if (result.success) {
      spin.succeed(`[${hook.name}] Done`);
      return true;
    }

    if (attempt < maxAttempts) {
      spin.warn(`[${hook.name}] Failed, retrying in ${retry_delay / 1000}s...`);
      await sleep(retry_delay);
    } else {
      if (continue_on_error) {
        spin.warn(`[${hook.name}] Failed (continuing)`);
        return true;
      }
      spin.fail(`[${hook.name}] Failed: ${result.error || "Unknown error"}`);
      return false;
    }
  }

  return false;
}

export async function runHooks(
  hookType: HookType,
  options: RunOptions = {}
): Promise<boolean> {
  const hooks = getHooks(hookType, options.cwd);

  if (hooks.length === 0) {
    return true;
  }

  logger.info(`Running ${hookType} hooks...`);
  console.log();

  for (const hook of hooks) {
    const success = await runHook(hook, options);
    if (!success) {
      logger.error(`Hook "${hook.name}" failed, aborting ${hookType}`);
      return false;
    }
  }

  console.log();
  return true;
}

function showDryRun(
  taskName: string,
  description: string,
  command: string,
  useSudo: boolean,
  envVars: Record<string, string>
): void {
  console.log();
  logger.info(`Would execute task: ${taskName}`);
  console.log(`  Description: ${description}`);
  console.log(`  Command: ${command}`);
  if (useSudo) {
    console.log("  Sudo: yes");
  }
  if (Object.keys(envVars).length > 0) {
    console.log(`  Environment: ${Object.keys(envVars).join(", ")}`);
  }
  console.log();
}

async function promptConfirmation(
  taskName: string,
  description: string
): Promise<boolean> {
  const inquirer = await import("inquirer");
  const { confirmed } = await inquirer.default.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message: `Run task "${taskName}"? (${description})`,
      default: false,
    },
  ]);
  return confirmed;
}

async function executeTaskWithRetries(
  taskName: string,
  task: TaskDefinition,
  runOptions: RunOptions
): Promise<boolean> {
  const timeout = task.timeout ? task.timeout * 1000 : DEFAULT_TIMEOUT;
  const maxAttempts = (task.retries ?? 0) + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await runCommandAsync(task.run, {
      ...runOptions,
      timeout,
    });

    if (result.success) {
      console.log();
      logger.success(`Task "${taskName}" completed`);
      return true;
    }

    if (attempt < maxAttempts) {
      const delay = task.retry_delay ?? DEFAULT_RETRY_DELAY / 1000;
      logger.warn(`Task failed, retrying in ${delay}s...`);
      await sleep(delay * 1000);
    } else {
      console.log();
      logger.error(
        `Task "${taskName}" failed: ${result.error || "Unknown error"}`
      );
      return false;
    }
  }

  return false;
}

export async function runTask(
  taskName: string,
  options: {
    cwd?: string;
    dryRun?: boolean;
    env?: Record<string, string>;
    skipConfirm?: boolean;
    sudo?: boolean;
  } = {}
): Promise<boolean> {
  const task = getTask(taskName, options.cwd);

  if (!task) {
    logger.error(`Task "${taskName}" not found`);
    return false;
  }

  const description = task.description || taskName;
  const envVars = { ...parseEnvArray(task.env), ...options.env };
  const useSudo = options.sudo ?? task.sudo ?? false;

  if (options.dryRun) {
    showDryRun(taskName, description, task.run, useSudo, envVars);
    return true;
  }

  if (task.confirm && !options.skipConfirm) {
    const confirmed = await promptConfirmation(taskName, description);
    if (!confirmed) {
      logger.info("Task cancelled");
      return false;
    }
  }

  console.log();
  logger.info(`Running task: ${taskName}`);
  console.log();

  return executeTaskWithRetries(taskName, task, {
    cwd: options.cwd,
    env: envVars,
    sudo: useSudo,
    interactive: task.interactive,
  });
}
