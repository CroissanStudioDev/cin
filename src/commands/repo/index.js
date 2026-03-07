import { Command } from "commander";
import { addCommand } from "./add.js";
import { listCommand } from "./list.js";
import { removeCommand } from "./remove.js";

export const repoCommand = new Command("repo")
  .description("Manage repositories")
  .addCommand(addCommand)
  .addCommand(listCommand)
  .addCommand(removeCommand);
