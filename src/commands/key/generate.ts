import { existsSync } from "node:fs";
import chalk from "chalk";
import { Command } from "commander";
import {
  generateSigningKeyPair,
  getSigningKeyPaths,
  saveKeyPair,
} from "../../lib/signing.js";
import { EXIT_CODES } from "../../utils/exit-codes.js";
import { logger, spinner } from "../../utils/logger.js";

interface GenerateOptions {
  force?: boolean;
  output?: string;
}

export const generateCommand = new Command("generate")
  .description("Generate signing key pair for package verification")
  .option("-o, --output <dir>", "Output directory for keys (default: ~/.cin/)")
  .option("-f, --force", "Overwrite existing keys")
  .action((options: GenerateOptions) => {
    const { privateKeyPath, publicKeyPath } = options.output
      ? {
          privateKeyPath: `${options.output}/signing-key.pem`,
          publicKeyPath: `${options.output}/signing-key.pub`,
        }
      : getSigningKeyPaths();

    if (
      (existsSync(privateKeyPath) || existsSync(publicKeyPath)) &&
      !options.force
    ) {
      logger.error("Signing keys already exist");
      console.log(`  Private: ${privateKeyPath}`);
      console.log(`  Public:  ${publicKeyPath}`);
      console.log();
      logger.info("Use --force to overwrite");
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    const spin = spinner("Generating Ed25519 key pair...").start();

    try {
      const keyPair = generateSigningKeyPair();
      saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

      spin.succeed("Signing keys generated");
      console.log();
      console.log(chalk.bold("Key files:"));
      console.log(`  ${chalk.red("Private key:")} ${privateKeyPath}`);
      console.log(`  ${chalk.green("Public key:")}  ${publicKeyPath}`);
      console.log();
      console.log(chalk.bold("Usage:"));
      console.log(chalk.gray("  # Sign a package"));
      console.log(chalk.gray("  cin sign <package.tar.gz>"));
      console.log();
      console.log(chalk.gray("  # Verify a signed package"));
      console.log(
        chalk.gray("  cin verify <package.tar.gz> --key <public-key>")
      );
      console.log();
      logger.warn("Keep your private key secure and never share it!");
      logger.info("Distribute the public key (.pub) to verify packages");
    } catch (error) {
      spin.fail(`Failed to generate keys: ${(error as Error).message}`);
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });
