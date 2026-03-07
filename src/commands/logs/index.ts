import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { collectCommand } from "./collect.js";

export const logsCommand = new Command("logs")
  .description("View and collect application logs")
  .option("-f, --follow", "Follow log output")
  .option("-n, --tail <lines>", "Number of lines to show", "100")
  .option("-t, --target <path>", "Target directory", "/opt/app")
  .action((options: { follow?: boolean; tail: string; target: string }) => {
    const currentDir = join(options.target, "current");

    if (!existsSync(currentDir)) {
      console.error(`No deployment found at ${options.target}`);
      console.log("Use 'cin logs collect' to collect logs from a custom path");
      process.exit(1);
    }

    const args = ["compose", "logs"];

    if (options.follow) {
      args.push("-f");
    }

    args.push("--tail", options.tail);

    const proc = spawn("docker", args, {
      cwd: currentDir,
      stdio: "inherit",
    });

    proc.on("error", (err) => {
      console.error(`Failed to run docker compose logs: ${err.message}`);
      process.exit(1);
    });

    proc.on("close", (code) => {
      process.exit(code ?? 0);
    });
  })
  .addCommand(collectCommand);
