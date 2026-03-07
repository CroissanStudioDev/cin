import { Command } from "commander";
import { listCommand } from "./list.js";

export const tasksCommand = new Command("tasks")
  .description("Manage and list available tasks")
  .addCommand(listCommand);
