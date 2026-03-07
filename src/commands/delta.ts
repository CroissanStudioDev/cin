import { existsSync, statSync } from "node:fs";
import chalk from "chalk";
import { Command } from "commander";
import { applyDelta, createDelta, readDeltaManifest } from "../lib/delta.js";
import { logger, spinner } from "../utils/logger.js";

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export const deltaCommand = new Command("delta")
  .description("Create delta package (only changes between versions)")
  .argument("<old-package>", "Path to old package (.tar.gz)")
  .argument("<new-package>", "Path to new package (.tar.gz)")
  .option("-o, --output <path>", "Output path for delta package", "./releases")
  .action(
    async (
      oldPackage: string,
      newPackage: string,
      options: { output: string }
    ) => {
      if (!existsSync(oldPackage)) {
        logger.error(`Old package not found: ${oldPackage}`);
        process.exit(1);
      }

      if (!existsSync(newPackage)) {
        logger.error(`New package not found: ${newPackage}`);
        process.exit(1);
      }

      const spin = spinner("Creating delta package...").start();

      try {
        const { deltaPath, stats } = await createDelta(
          oldPackage,
          newPackage,
          options.output
        );

        spin.succeed("Delta package created");
        console.log();

        console.log(chalk.bold("Changes:"));
        console.log(`  Added:    ${chalk.green(`+${stats.added}`)} files`);
        console.log(`  Modified: ${chalk.yellow(`~${stats.modified}`)} files`);
        console.log(`  Removed:  ${chalk.red(`-${stats.removed}`)} files`);
        console.log();

        console.log(chalk.bold("Size comparison:"));
        console.log(`  Full package: ${formatSize(stats.newSize)}`);
        console.log(
          `  Delta:        ${chalk.green(formatSize(stats.deltaSize))}`
        );
        console.log(
          `  Saved:        ${chalk.cyan(`${formatSize(stats.savedBytes)} (${stats.savedPercent}%)`)}`
        );
        console.log();

        console.log(`Output: ${chalk.green(deltaPath)}`);
        console.log();
        logger.info("Apply delta with: cin patch <old-package> <delta>");
      } catch (error) {
        spin.fail(`Failed to create delta: ${(error as Error).message}`);
        process.exit(1);
      }
    }
  );

export const patchCommand = new Command("patch")
  .description("Apply delta to old package to create new package")
  .argument("<old-package>", "Path to old package (.tar.gz)")
  .argument("<delta>", "Path to delta package (.tar.gz)")
  .option("-o, --output <path>", "Output path for new package", "./releases")
  .action(
    async (oldPackage: string, delta: string, options: { output: string }) => {
      if (!existsSync(oldPackage)) {
        logger.error(`Old package not found: ${oldPackage}`);
        process.exit(1);
      }

      if (!existsSync(delta)) {
        logger.error(`Delta package not found: ${delta}`);
        process.exit(1);
      }

      // Show delta info
      console.log(chalk.bold("\n=== Delta Info ===\n"));

      try {
        const manifest = await readDeltaManifest(delta);
        console.log(`  Base:   ${chalk.gray(manifest.basePackage.name)}`);
        console.log(`  Target: ${chalk.cyan(manifest.targetPackage.name)}`);
        console.log(
          `  Changes: +${manifest.added.length} ~${manifest.modified.length} -${manifest.removed.length}`
        );
        console.log();
      } catch {
        logger.warn("Could not read delta manifest");
      }

      const spin = spinner("Applying delta...").start();

      try {
        const outputPath = await applyDelta(oldPackage, delta, options.output);
        const outputSize = statSync(outputPath).size;

        spin.succeed("Delta applied");
        console.log();
        console.log(`Output: ${chalk.green(outputPath)}`);
        console.log(`Size:   ${formatSize(outputSize)}`);
        console.log();
        logger.info("Verify with: cin verify <package>");
      } catch (error) {
        spin.fail(`Failed to apply delta: ${(error as Error).message}`);
        process.exit(1);
      }
    }
  );
