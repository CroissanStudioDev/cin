#!/usr/bin/env node

import { program } from "commander";
import { buildCommand } from "../src/commands/build.js";
import { deployCommand } from "../src/commands/deploy.js";
import { initCommand } from "../src/commands/init.js";
import { keyCommand } from "../src/commands/key/index.js";
import { packCommand } from "../src/commands/pack.js";
import { pullCommand } from "../src/commands/pull.js";
import { repoCommand } from "../src/commands/repo/index.js";
import { rollbackCommand } from "../src/commands/rollback.js";
import { statusCommand } from "../src/commands/status.js";
import { verifyCommand } from "../src/commands/verify.js";
import { runInteractiveMenu } from "../src/menu.js";

program
  .name("cin")
  .description("CLI for delivering code to airgapped environments")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(repoCommand);
program.addCommand(keyCommand);
program.addCommand(pullCommand);
program.addCommand(buildCommand);
program.addCommand(packCommand);
program.addCommand(deployCommand);
program.addCommand(verifyCommand);
program.addCommand(rollbackCommand);
program.addCommand(statusCommand);

// Show interactive menu if no arguments provided
if (process.argv.length <= 2) {
  runInteractiveMenu().catch(console.error);
} else {
  program.parse();
}
