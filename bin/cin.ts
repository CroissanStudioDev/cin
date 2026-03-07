#!/usr/bin/env node

import { program } from "commander";
import { buildCommand } from "../src/commands/build.js";
import { deltaCommand, patchCommand } from "../src/commands/delta.js";
import { deployCommand } from "../src/commands/deploy.js";
import { initCommand } from "../src/commands/init.js";
import { keyCommand } from "../src/commands/key/index.js";
import { logsCommand } from "../src/commands/logs/index.js";
import { packCommand } from "../src/commands/pack.js";
import { pullCommand } from "../src/commands/pull.js";
import { repoCommand } from "../src/commands/repo/index.js";
import { rollbackCommand } from "../src/commands/rollback.js";
import { runCommand } from "../src/commands/run.js";
import { secretsCommand } from "../src/commands/secrets/index.js";
import { signCommand } from "../src/commands/sign.js";
import { statusCommand } from "../src/commands/status.js";
import { tasksCommand } from "../src/commands/tasks/index.js";
import { verifyCommand } from "../src/commands/verify.js";
import { setConfigPath } from "../src/lib/config.js";
import { runInteractiveMenu } from "../src/menu.js";

program
  .name("cin")
  .description("CLI for delivering code to airgapped environments")
  .version("0.1.0")
  .option("-c, --config <path>", "Path to project config directory")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.config) {
      setConfigPath(opts.config);
    }
  });

program.addCommand(initCommand);
program.addCommand(repoCommand);
program.addCommand(keyCommand);
program.addCommand(secretsCommand);
program.addCommand(pullCommand);
program.addCommand(buildCommand);
program.addCommand(packCommand);
program.addCommand(deltaCommand);
program.addCommand(patchCommand);
program.addCommand(signCommand);
program.addCommand(deployCommand);
program.addCommand(verifyCommand);
program.addCommand(rollbackCommand);
program.addCommand(logsCommand);
program.addCommand(tasksCommand);
program.addCommand(runCommand);
program.addCommand(statusCommand);

// Show interactive menu if no arguments provided
if (process.argv.length <= 2) {
  runInteractiveMenu().catch(console.error);
} else {
  program.parse();
}
