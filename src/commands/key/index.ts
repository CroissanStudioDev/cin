import { Command } from "commander";
import { addCommand } from "./add.js";
import { generateCommand } from "./generate.js";
import { listCommand } from "./list.js";
import { removeCommand } from "./remove.js";

export const keyCommand = new Command("key")
  .description("Manage SSH and signing keys")
  .addCommand(addCommand)
  .addCommand(listCommand)
  .addCommand(removeCommand)
  .addCommand(generateCommand);
