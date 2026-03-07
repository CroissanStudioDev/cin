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
import { checksumFile } from "../utils/checksum.js";
import { logger, spinner } from "../utils/logger.js";

export const verifyCommand = new Command("verify")
  .description("Verify package integrity")
  .argument("<package>", "Path to package file (.tar.gz)")
  .option("--checksums", "Show all checksums")
  .action(async (packagePath, options) => {
    if (!existsSync(packagePath)) {
      logger.error(`Package not found: ${packagePath}`);
      process.exit(1);
    }

    await verifyPackage(packagePath, options);
  });

/**
 * Display package info from manifest
 */
function displayPackageInfo(manifest) {
  console.log(chalk.bold("\n=== Package Info ===\n"));
  console.log(`  Name:    ${chalk.cyan(manifest.package?.name || "unknown")}`);
  console.log(`  Created: ${manifest.package?.created || "unknown"}`);
  console.log(`  By:      ${manifest.package?.created_by || "unknown"}`);

  if (manifest.project) {
    console.log(`\n  Project: ${manifest.project.name || "unnamed"}`);
    console.log(`  Type:    ${manifest.project.type || "unknown"}`);
  }

  if (manifest.vendor?.name) {
    console.log(`  Vendor:  ${manifest.vendor.name}`);
  }
}

/**
 * Display repositories from manifest
 */
function displayRepositories(manifest) {
  if (!manifest.repositories?.length) {
    return;
  }

  console.log(chalk.bold("\n=== Repositories ===\n"));
  for (const repo of manifest.repositories) {
    const commitShort = repo.commit?.substring(0, 12) || "unknown";
    console.log(`  ${chalk.yellow(repo.name)}`);
    console.log(`    Branch: ${repo.branch}`);
    console.log(`    Commit: ${chalk.gray(commitShort)}`);
    if (repo.submodules?.length > 0) {
      console.log(`    Submodules: ${repo.submodules.length}`);
    }
  }
}

/**
 * Display Docker images from manifest
 */
function displayDockerImages(manifest) {
  if (!manifest.docker?.images?.length) {
    return;
  }

  console.log(chalk.bold("\n=== Docker Images ===\n"));
  for (const image of manifest.docker.images) {
    const size = formatSize(image.size || 0);
    console.log(`  ${chalk.cyan(image.name)} (${size})`);
  }
  console.log(`\n  Total: ${formatSize(manifest.docker.total_size || 0)}`);
}

/**
 * Verify checksums and return counts
 */
async function verifyAllChecksums(packageDir, checksums, showAll) {
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

/**
 * Display verification summary
 */
function displaySummary(valid, invalid, missing) {
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

/**
 * Verify package integrity
 */
async function verifyPackage(packagePath, options) {
  const tempDir = join(tmpdir(), `cin-verify-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  const spin = spinner("Extracting package...").start();

  try {
    await extractTar({ file: packagePath, cwd: tempDir });
    spin.succeed("Package extracted");
  } catch (error) {
    spin.fail(`Failed to extract package: ${error.message}`);
    rmSync(tempDir, { recursive: true });
    process.exit(1);
  }

  const extracted = readdirSync(tempDir);
  if (extracted.length !== 1) {
    logger.error("Invalid package structure");
    rmSync(tempDir, { recursive: true });
    process.exit(1);
  }

  const packageDir = join(tempDir, extracted[0]);
  const manifestPath = join(packageDir, "manifest.json");

  if (!existsSync(manifestPath)) {
    logger.error("Package missing manifest.json");
    rmSync(tempDir, { recursive: true });
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  displayPackageInfo(manifest);
  displayRepositories(manifest);
  displayDockerImages(manifest);

  console.log(chalk.bold("\n=== Checksum Verification ===\n"));

  const checksums = manifest.checksums || {};
  const { valid, invalid, missing } = await verifyAllChecksums(
    packageDir,
    checksums,
    options.checksums
  );

  displaySummary(valid, invalid, missing);

  rmSync(tempDir, { recursive: true });

  if (invalid > 0 || missing > 0) {
    process.exit(1);
  }
}

/**
 * Format file size
 */
function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
