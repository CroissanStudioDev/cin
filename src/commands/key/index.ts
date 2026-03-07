import { Command } from "commander";
import { addCommand } from "./add.js";
import { listCommand } from "./list.js";
import { removeCommand } from "./remove.js";

export const keyCommand = new Command("key")
  .description("Manage SSH keys")
  .addCommand(addCommand)
  .addCommand(listCommand)
  .addCommand(removeCommand);
