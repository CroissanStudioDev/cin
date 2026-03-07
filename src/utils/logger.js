import chalk from "chalk";
import ora from "ora";

export const logger = {
  info: (msg) => console.log(chalk.blue("ℹ"), msg),
  success: (msg) => console.log(chalk.green("✓"), msg),
  warn: (msg) => console.log(chalk.yellow("⚠"), msg),
  error: (msg) => console.log(chalk.red("✗"), msg),
  skip: (msg) => console.log(chalk.gray("[SKIP]"), msg),
  update: (msg) => console.log(chalk.cyan("[UPDATE]"), msg),
  new: (msg) => console.log(chalk.green("[NEW]"), msg),
};

export const spinner = (text) => ora({ text, color: "cyan" });

export const formatPath = (p) => chalk.cyan(p);
export const formatRepo = (name) => chalk.yellow(name);
export const formatVersion = (v) => chalk.magenta(v);
