#!/usr/bin/env node

import { CommanderError, program } from "commander";
import { buildCommand } from "../src/commands/build.js";
import { deltaCommand, patchCommand } from "../src/commands/delta.js";
import { deployCommand } from "../src/commands/deploy.js";
import { initCommand } from "../src/commands/init.js";
import { keyCommand } from "../src/commands/key/index.js";
import { logsCommand } from "../src/commands/logs/index.js";
import { packCommand } from "../src/commands/pack.js";
import { pullCommand } from "../src/commands/pull.js";
import { releaseCommand } from "../src/commands/release/index.js";
import { repoCommand } from "../src/commands/repo/index.js";
import { rollbackCommand } from "../src/commands/rollback.js";
import { runCommand } from "../src/commands/run.js";
import { secretsCommand } from "../src/commands/secrets/index.js";
import { signCommand } from "../src/commands/sign.js";
import { statusCommand } from "../src/commands/status.js";
import { tasksCommand } from "../src/commands/tasks/index.js";
import {
  updateCommand,
  updateRollbackCommand,
} from "../src/commands/update.js";
import { verifyCommand } from "../src/commands/verify.js";
import { setConfigPath } from "../src/lib/config.js";
import { runInteractiveMenu } from "../src/menu.js";
import { EXIT_CODES } from "../src/utils/exit-codes.js";
import { logger } from "../src/utils/logger.js";
import { VERSION } from "../src/utils/version.js";

program
  .name("cin")
  .description("CLI for delivering code to airgapped environments")
  .version(VERSION)
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
program.addCommand(releaseCommand);

// Update command with rollback subcommand
updateCommand.addCommand(updateRollbackCommand);
program.addCommand(updateCommand);

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

// Enable custom error handling
program.exitOverride();

async function main(): Promise<void> {
  // Show interactive menu if no arguments provided
  if (process.argv.length <= 2) {
    await runInteractiveMenu();
    return;
  }

  await program.parseAsync();
}

main().catch((err) => {
  // Handle Commander.js errors (--help, --version, invalid args)
  if (err instanceof CommanderError) {
    // Help and version are not errors
    if (
      err.code === "commander.helpDisplayed" ||
      err.code === "commander.version"
    ) {
      process.exit(EXIT_CODES.SUCCESS);
    }
    // Invalid usage
    if (
      err.code === "commander.missingArgument" ||
      err.code === "commander.missingMandatoryOptionValue"
    ) {
      process.exit(EXIT_CODES.MISUSE);
    }
    process.exit(err.exitCode);
  }

  // Handle application errors
  logger.error(err.message || String(err));

  // Debug mode: show stack trace
  if (process.env.DEBUG) {
    console.error(err.stack);
  }

  process.exit(EXIT_CODES.GENERAL_ERROR);
});
