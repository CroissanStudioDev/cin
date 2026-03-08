import { existsSync } from "node:fs";
import chalk from "chalk";
import { Command } from "commander";
import {
  generateSigningKeyPair,
  getSignatureFilePath,
  getSigningKeyPaths,
  saveKeyPair,
  signingKeysExist,
  signPackage,
} from "../lib/signing.js";
import { EXIT_CODES } from "../utils/exit-codes.js";
import { logger, spinner } from "../utils/logger.js";

interface SignOptions {
  key?: string;
  output?: string;
}

export const signCommand = new Command("sign")
  .description("Sign a package for verification")
  .argument("<package>", "Path to package file (.tar.gz)")
  .option(
    "-k, --key <path>",
    "Path to private key (default: ~/.cin/signing-key.pem)"
  )
  .option("-o, --output <path>", "Output path for signature file")
  .action((packagePath: string, options: SignOptions) => {
    if (!existsSync(packagePath)) {
      logger.error(`Package not found: ${packagePath}`);
      process.exit(EXIT_CODES.FILE_ERROR);
    }

    // Find private key
    let privateKeyPath = options.key;
    if (!privateKeyPath) {
      const { privateKeyPath: defaultPath } = getSigningKeyPaths();
      if (!existsSync(defaultPath)) {
        logger.error("No signing key found");
        console.log();
        logger.info("Generate a signing key pair with:");
        console.log(chalk.gray("  cin key generate --signing"));
        console.log();
        logger.info("Or specify a key with --key <path>");
        process.exit(EXIT_CODES.CONFIG_ERROR);
      }
      privateKeyPath = defaultPath;
    }

    if (!existsSync(privateKeyPath)) {
      logger.error(`Private key not found: ${privateKeyPath}`);
      process.exit(EXIT_CODES.FILE_ERROR);
    }

    const spin = spinner("Signing package...").start();

    try {
      const signatureInfo = signPackage(packagePath, privateKeyPath);
      const sigPath = getSignatureFilePath(packagePath);

      spin.succeed("Package signed");
      console.log();
      console.log(chalk.bold("Signature details:"));
      console.log(`  Algorithm: ${chalk.cyan(signatureInfo.algorithm)}`);
      console.log(`  Key ID:    ${chalk.cyan(signatureInfo.keyId)}`);
      console.log(`  Signed at: ${chalk.gray(signatureInfo.signedAt)}`);
      console.log();
      console.log(`Signature file: ${chalk.green(sigPath)}`);
      console.log();
      logger.info("Distribute the .sig file alongside the package");
      logger.info("Verify with: cin verify <package> --key <public-key>");
    } catch (error) {
      spin.fail(`Failed to sign package: ${(error as Error).message}`);
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });

// Subcommand for generating signing keys
export const generateSigningKeysCommand = new Command("generate")
  .description("Generate a new signing key pair")
  .option("--signing", "Generate Ed25519 signing keys")
  .option("-o, --output <dir>", "Output directory for keys")
  .option("-f, --force", "Overwrite existing keys")
  .action(
    (options: { signing?: boolean; output?: string; force?: boolean }) => {
      if (!options.signing) {
        // This is handled by the parent key command for SSH keys
        return;
      }

      const { privateKeyPath, publicKeyPath } = options.output
        ? {
            privateKeyPath: `${options.output}/signing-key.pem`,
            publicKeyPath: `${options.output}/signing-key.pub`,
          }
        : getSigningKeyPaths();

      if (signingKeysExist() && !options.force) {
        logger.error("Signing keys already exist");
        console.log(`  Private: ${privateKeyPath}`);
        console.log(`  Public:  ${publicKeyPath}`);
        console.log();
        logger.info("Use --force to overwrite");
        process.exit(EXIT_CODES.CONFIG_ERROR);
      }

      const spin = spinner("Generating Ed25519 key pair...").start();

      try {
        const keyPair = generateSigningKeyPair();
        saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

        spin.succeed("Signing keys generated");
        console.log();
        console.log(chalk.bold("Key files:"));
        console.log(`  Private key: ${chalk.yellow(privateKeyPath)}`);
        console.log(`  Public key:  ${chalk.green(publicKeyPath)}`);
        console.log();
        console.log(chalk.bold("Usage:"));
        console.log(chalk.gray("  # Sign a package"));
        console.log(chalk.gray("  cin sign <package.tar.gz>"));
        console.log();
        console.log(chalk.gray("  # Verify with public key"));
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
    }
  );
