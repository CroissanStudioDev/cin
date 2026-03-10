import { Command } from "commander";
import { releaseCheckoutCommand } from "./checkout.js";
import { releaseListCommand } from "./list.js";

export const releaseCommand = new Command("release")
  .description("Manage releases (git tags)")
  .addCommand(releaseListCommand)
  .addCommand(releaseCheckoutCommand);
