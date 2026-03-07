import chalk from "chalk";
import ora, { type Ora } from "ora";

export const logger = {
  info: (msg: string): void => console.log(chalk.blue("ℹ"), msg),
  success: (msg: string): void => console.log(chalk.green("✓"), msg),
  warn: (msg: string): void => console.log(chalk.yellow("⚠"), msg),
  error: (msg: string): void => console.log(chalk.red("✗"), msg),
  skip: (msg: string): void => console.log(chalk.gray("[SKIP]"), msg),
  update: (msg: string): void => console.log(chalk.cyan("[UPDATE]"), msg),
  new: (msg: string): void => console.log(chalk.green("[NEW]"), msg),
};

export const spinner = (text: string): Ora => ora({ text, color: "cyan" });

export const formatPath = (p: string): string => chalk.cyan(p);
export const formatRepo = (name: string): string => chalk.yellow(name);
export const formatVersion = (v: string): string => chalk.magenta(v);
