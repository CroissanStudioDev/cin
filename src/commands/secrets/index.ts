import { Command } from "commander";
import { checkCommand } from "./check.js";
import { exportCommand } from "./export.js";
import { importCommand } from "./import.js";
import { listCommand } from "./list.js";
import { setupCommand } from "./setup.js";

export const secretsCommand = new Command("secrets")
  .description("Manage application secrets")
  .addCommand(setupCommand)
  .addCommand(importCommand)
  .addCommand(listCommand)
  .addCommand(checkCommand)
  .addCommand(exportCommand);
