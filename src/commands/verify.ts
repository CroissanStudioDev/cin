import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { extract as extractTar } from "tar";
import {
  getSignatureFilePath,
  getSigningKeyPaths,
  verifyPackage as verifyPackageSignature,
} from "../lib/signing.js";
import { checksumFile } from "../utils/checksum.js";
import { EXIT_CODES } from "../utils/exit-codes.js";
import { logger, spinner } from "../utils/logger.js";

interface DockerImage {
  name: string;
  size: number;
}

interface RepoInfo {
  branch?: string;
  commit?: string;
  name: string;
  submodules?: Array<{ path: string; commit: string }>;
}

interface Manifest {
  checksums?: Record<string, string>;
  docker?: {
    images?: DockerImage[];
    total_size?: number;
  };
  package?: {
    name?: string;
    created?: string;
    created_by?: string;
  };
  project?: {
    name?: string;
    type?: string;
  };
  repositories?: RepoInfo[];
  vendor?: {
    name?: string;
  };
}

interface VerifyOptions {
  checksums?: boolean;
  key?: string;
  signature?: boolean;
}

export const verifyCommand = new Command("verify")
  .description("Verify package integrity and signature")
  .argument("<package>", "Path to package file (.tar.gz)")
  .option("--checksums", "Show all checksums")
  .option("-k, --key <path>", "Path to public key for signature verification")
  .option(
    "-s, --signature",
    "Verify signature only (skip checksum verification)"
  )
  .action(async (packagePath: string, options: VerifyOptions) => {
    if (!existsSync(packagePath)) {
      logger.error(`Package not found: ${packagePath}`);
      process.exit(EXIT_CODES.FILE_ERROR);
    }

    // Signature verification
    const sigPath = getSignatureFilePath(packagePath);
    const hasSignature = existsSync(sigPath);

    if (options.key || hasSignature) {
      verifySignature(packagePath, options.key, hasSignature);

      if (options.signature) {
        return; // Only verify signature
      }
    } else if (options.signature) {
      logger.error("No signature file found (.sig)");
      logger.info("Sign the package with: cin sign <package>");
      process.exit(EXIT_CODES.FILE_ERROR);
    }

    // Content verification
    if (!options.signature) {
      await verifyPackageContent(packagePath, options);
    }
  });

function verifySignature(
  packagePath: string,
  publicKeyPath: string | undefined,
  hasSignature: boolean
): void {
  console.log(chalk.bold("\n=== Signature Verification ===\n"));

  if (!hasSignature) {
    console.log(chalk.yellow("  ⚠ No signature file found"));
    console.log(chalk.gray("    Package is not signed"));
    console.log();
    return;
  }

  // Find public key
  let keyPath = publicKeyPath;
  if (!keyPath) {
    const { publicKeyPath: defaultPath } = getSigningKeyPaths();
    if (existsSync(defaultPath)) {
      keyPath = defaultPath;
    } else {
      console.log(
        chalk.yellow("  ⚠ Signature found but no public key provided")
      );
      console.log(chalk.gray("    Use --key <path> to verify signature"));
      console.log();
      return;
    }
  }

  if (!existsSync(keyPath)) {
    logger.error(`Public key not found: ${keyPath}`);
    process.exit(EXIT_CODES.FILE_ERROR);
  }

  const result = verifyPackageSignature(packagePath, keyPath);

  if (result.valid) {
    console.log(chalk.green("  ✓ Signature is valid"));
    if (result.signatureInfo) {
      console.log(`    Algorithm: ${result.signatureInfo.algorithm}`);
      console.log(`    Key ID:    ${result.signatureInfo.keyId}`);
      console.log(
        `    Signed at: ${chalk.gray(result.signatureInfo.signedAt)}`
      );
    }
  } else {
    console.log(chalk.red("  ✗ Signature verification failed"));
    console.log(`    ${result.error}`);
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  console.log();
}

function displayPackageInfo(manifest: Manifest): void {
  console.log(chalk.bold("\n=== Package Info ===\n"));
  console.log(`  Name:    ${chalk.cyan(manifest.package?.name ?? "unknown")}`);
  console.log(`  Created: ${manifest.package?.created ?? "unknown"}`);
  console.log(`  By:      ${manifest.package?.created_by ?? "unknown"}`);

  if (manifest.project) {
    console.log(`\n  Project: ${manifest.project.name ?? "unnamed"}`);
    console.log(`  Type:    ${manifest.project.type ?? "unknown"}`);
  }

  if (manifest.vendor?.name) {
    console.log(`  Vendor:  ${manifest.vendor.name}`);
  }
}

function displayRepositories(manifest: Manifest): void {
  if (!manifest.repositories?.length) {
    return;
  }

  console.log(chalk.bold("\n=== Repositories ===\n"));
  for (const repo of manifest.repositories) {
    const commitShort = repo.commit?.substring(0, 12) ?? "unknown";
    console.log(`  ${chalk.yellow(repo.name)}`);
    console.log(`    Branch: ${repo.branch ?? "unknown"}`);
    console.log(`    Commit: ${chalk.gray(commitShort)}`);
    if (repo.submodules && repo.submodules.length > 0) {
      console.log(`    Submodules: ${repo.submodules.length}`);
    }
  }
}

function displayDockerImages(manifest: Manifest): void {
  if (!manifest.docker?.images?.length) {
    return;
  }

  console.log(chalk.bold("\n=== Docker Images ===\n"));
  for (const image of manifest.docker.images) {
    const size = formatSize(image.size ?? 0);
    console.log(`  ${chalk.cyan(image.name)} (${size})`);
  }
  console.log(`\n  Total: ${formatSize(manifest.docker.total_size ?? 0)}`);
}

interface ChecksumResult {
  invalid: number;
  missing: number;
  valid: number;
}

async function verifyAllChecksums(
  packageDir: string,
  checksums: Record<string, string>,
  showAll?: boolean
): Promise<ChecksumResult> {
  let valid = 0;
  let invalid = 0;
  let missing = 0;

  for (const [relativePath, expectedChecksum] of Object.entries(checksums)) {
    const filePath = join(packageDir, relativePath);

    if (!existsSync(filePath)) {
      console.log(`  ${chalk.red("✗")} ${relativePath} - MISSING`);
      missing++;
      continue;
    }

    const actualChecksum = await checksumFile(filePath);

    if (actualChecksum === expectedChecksum) {
      if (showAll) {
        console.log(`  ${chalk.green("✓")} ${relativePath}`);
        console.log(`    ${chalk.gray(expectedChecksum)}`);
      }
      valid++;
    } else {
      console.log(`  ${chalk.red("✗")} ${relativePath} - INVALID`);
      console.log(`    Expected: ${chalk.gray(expectedChecksum)}`);
      console.log(`    Actual:   ${chalk.red(actualChecksum)}`);
      invalid++;
    }
  }

  return { valid, invalid, missing };
}

function displaySummary(valid: number, invalid: number, missing: number): void {
  console.log(chalk.bold("\n=== Summary ===\n"));

  if (invalid === 0 && missing === 0) {
    console.log(chalk.green("  ✓ Package is valid"));
    console.log(`    ${valid} file(s) verified`);
  } else {
    console.log(chalk.red("  ✗ Package verification failed"));
    if (invalid > 0) {
      console.log(`    ${invalid} file(s) with invalid checksum`);
    }
    if (missing > 0) {
      console.log(`    ${missing} file(s) missing`);
    }
  }

  console.log();
}

async function verifyPackageContent(
  packagePath: string,
  options: VerifyOptions
): Promise<void> {
  const tempDir = join(tmpdir(), `cin-verify-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  const spin = spinner("Extracting package...").start();

  try {
    await extractTar({ file: packagePath, cwd: tempDir });
    spin.succeed("Package extracted");
  } catch (error) {
    spin.fail(`Failed to extract package: ${(error as Error).message}`);
    rmSync(tempDir, { recursive: true });
    process.exit(EXIT_CODES.GENERAL_ERROR);
  }

  const extracted = readdirSync(tempDir);
  if (extracted.length !== 1) {
    logger.error("Invalid package structure");
    rmSync(tempDir, { recursive: true });
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  const packageDir = join(tempDir, extracted[0]);
  const manifestPath = join(packageDir, "manifest.json");

  if (!existsSync(manifestPath)) {
    logger.error("Package missing manifest.json");
    rmSync(tempDir, { recursive: true });
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }

  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  displayPackageInfo(manifest);
  displayRepositories(manifest);
  displayDockerImages(manifest);

  console.log(chalk.bold("\n=== Checksum Verification ===\n"));

  const checksums = manifest.checksums ?? {};
  const { valid, invalid, missing } = await verifyAllChecksums(
    packageDir,
    checksums,
    options.checksums
  );

  displaySummary(valid, invalid, missing);

  rmSync(tempDir, { recursive: true });

  if (invalid > 0 || missing > 0) {
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }
}

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
