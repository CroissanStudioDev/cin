#!/usr/bin/env node

import { program } from "commander";
import { buildCommand } from "../src/commands/build.js";
import { initCommand } from "../src/commands/init.js";
import { keyCommand } from "../src/commands/key/index.js";
import { pullCommand } from "../src/commands/pull.js";
import { repoCommand } from "../src/commands/repo/index.js";
import { statusCommand } from "../src/commands/status.js";

program
  .name("cin")
  .description("CLI for delivering code to airgapped environments")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(repoCommand);
program.addCommand(keyCommand);
program.addCommand(pullCommand);
program.addCommand(buildCommand);
program.addCommand(statusCommand);

program.parse();
