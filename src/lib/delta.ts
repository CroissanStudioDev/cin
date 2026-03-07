import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { create as createTar, extract as extractTar } from "tar";
import { checksumFile } from "../utils/checksum.js";

export interface DeltaManifest {
  added: string[];
  basePackage: {
    checksum: string;
    name: string;
  };
  created: string;
  modified: string[];
  removed: string[];
  targetPackage: {
    checksum: string;
    name: string;
  };
  version: string;
}

interface PackageManifest {
  checksums?: Record<string, string>;
  package?: {
    name?: string;
  };
}

/**
 * Extract package to temp directory and return path
 */
async function extractPackage(packagePath: string): Promise<string> {
  const tempDir = join(
    tmpdir(),
    `cin-delta-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(tempDir, { recursive: true });

  await extractTar({ file: packagePath, cwd: tempDir });

  // Find extracted directory (filter hidden files like .DS_Store)
  const entries = readdirSync(tempDir).filter((e) => !e.startsWith("."));
  if (entries.length !== 1) {
    throw new Error("Invalid package structure");
  }

  return join(tempDir, entries[0]);
}

/**
 * Get all files recursively with relative paths
 */
function getAllFiles(dir: string, base = ""): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relativePath = base ? `${base}/${entry}` : entry;
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, relativePath));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * Create delta package between old and new versions
 */
export async function createDelta(
  oldPackagePath: string,
  newPackagePath: string,
  outputPath: string
): Promise<{ stats: DeltaStats; deltaPath: string }> {
  // Extract both packages
  const oldDir = await extractPackage(oldPackagePath);
  const newDir = await extractPackage(newPackagePath);

  try {
    // Load manifests
    const oldManifestPath = join(oldDir, "manifest.json");
    const newManifestPath = join(newDir, "manifest.json");

    if (!(existsSync(oldManifestPath) && existsSync(newManifestPath))) {
      throw new Error("Package missing manifest.json");
    }

    const oldManifest: PackageManifest = JSON.parse(
      readFileSync(oldManifestPath, "utf-8")
    );
    const newManifest: PackageManifest = JSON.parse(
      readFileSync(newManifestPath, "utf-8")
    );

    const oldChecksums = oldManifest.checksums ?? {};
    const newChecksums = newManifest.checksums ?? {};

    // Compare files
    const oldFiles = new Set(Object.keys(oldChecksums));
    const newFiles = new Set(Object.keys(newChecksums));

    const added: string[] = [];
    const modified: string[] = [];
    const removed: string[] = [];

    // Find added and modified files
    for (const file of newFiles) {
      if (!oldFiles.has(file)) {
        added.push(file);
      } else if (oldChecksums[file] !== newChecksums[file]) {
        modified.push(file);
      }
    }

    // Find removed files
    for (const file of oldFiles) {
      if (!newFiles.has(file)) {
        removed.push(file);
      }
    }

    // Create delta staging directory
    const deltaName = `${newManifest.package?.name ?? "package"}-delta`;
    const stagingDir = join(tmpdir(), `cin-delta-staging-${Date.now()}`);
    const deltaDir = join(stagingDir, deltaName);
    mkdirSync(join(deltaDir, "files"), { recursive: true });

    // Copy changed files
    for (const file of [...added, ...modified]) {
      const srcPath = join(newDir, file);
      const destPath = join(deltaDir, "files", file);
      mkdirSync(dirname(destPath), { recursive: true });
      cpSync(srcPath, destPath);
    }

    // Also copy manifest.json
    cpSync(newManifestPath, join(deltaDir, "files", "manifest.json"));

    // Create delta manifest
    const deltaManifest: DeltaManifest = {
      version: "1.0",
      created: new Date().toISOString(),
      basePackage: {
        name: oldManifest.package?.name ?? "unknown",
        checksum: await checksumFile(oldPackagePath),
      },
      targetPackage: {
        name: newManifest.package?.name ?? "unknown",
        checksum: await checksumFile(newPackagePath),
      },
      added,
      modified,
      removed,
    };

    writeFileSync(
      join(deltaDir, "delta-manifest.json"),
      JSON.stringify(deltaManifest, null, 2)
    );

    // Create delta archive
    const deltaPath = outputPath.endsWith(".tar.gz")
      ? outputPath
      : `${outputPath}/${deltaName}.tar.gz`;

    mkdirSync(dirname(deltaPath), { recursive: true });

    await createTar(
      {
        gzip: true,
        file: deltaPath,
        cwd: stagingDir,
      },
      [deltaName]
    );

    // Calculate sizes
    const oldSize = statSync(oldPackagePath).size;
    const newSize = statSync(newPackagePath).size;
    const deltaSize = statSync(deltaPath).size;

    // Cleanup
    rmSync(stagingDir, { recursive: true });

    return {
      deltaPath,
      stats: {
        added: added.length,
        modified: modified.length,
        removed: removed.length,
        oldSize,
        newSize,
        deltaSize,
        savedBytes: newSize - deltaSize,
        savedPercent: Math.round((1 - deltaSize / newSize) * 100),
      },
    };
  } finally {
    // Cleanup extracted packages
    rmSync(dirname(oldDir), { recursive: true });
    rmSync(dirname(newDir), { recursive: true });
  }
}

export interface DeltaStats {
  added: number;
  deltaSize: number;
  modified: number;
  newSize: number;
  oldSize: number;
  removed: number;
  savedBytes: number;
  savedPercent: number;
}

/**
 * Apply delta to old package to create new package
 */
export async function applyDelta(
  oldPackagePath: string,
  deltaPath: string,
  outputPath: string
): Promise<string> {
  // Extract old package
  const oldDir = await extractPackage(oldPackagePath);

  // Extract delta
  const deltaExtractDir = join(tmpdir(), `cin-delta-apply-${Date.now()}`);
  mkdirSync(deltaExtractDir, { recursive: true });
  await extractTar({ file: deltaPath, cwd: deltaExtractDir });

  const deltaEntries = readdirSync(deltaExtractDir);
  if (deltaEntries.length !== 1) {
    throw new Error("Invalid delta package structure");
  }
  const deltaDir = join(deltaExtractDir, deltaEntries[0]);

  try {
    // Load delta manifest
    const deltaManifestPath = join(deltaDir, "delta-manifest.json");
    if (!existsSync(deltaManifestPath)) {
      throw new Error("Delta package missing delta-manifest.json");
    }

    const deltaManifest: DeltaManifest = JSON.parse(
      readFileSync(deltaManifestPath, "utf-8")
    );

    // Verify base package
    const oldChecksum = await checksumFile(oldPackagePath);
    if (oldChecksum !== deltaManifest.basePackage.checksum) {
      throw new Error(
        `Base package mismatch. Expected ${deltaManifest.basePackage.name}, got different package.`
      );
    }

    // Remove deleted files
    for (const file of deltaManifest.removed) {
      const filePath = join(oldDir, file);
      if (existsSync(filePath)) {
        rmSync(filePath);
      }
    }

    // Copy added and modified files
    const filesDir = join(deltaDir, "files");
    const deltaFiles = getAllFiles(filesDir);

    for (const file of deltaFiles) {
      const srcPath = join(filesDir, file);
      const destPath = join(oldDir, file);
      mkdirSync(dirname(destPath), { recursive: true });
      cpSync(srcPath, destPath);
    }

    // Create output package
    const newPackageName = deltaManifest.targetPackage.name;
    const stagingDir = dirname(oldDir);

    // Rename directory to new package name
    const newDir = join(stagingDir, newPackageName);
    if (oldDir !== newDir) {
      cpSync(oldDir, newDir, { recursive: true });
      rmSync(oldDir, { recursive: true });
    }

    const finalOutputPath = outputPath.endsWith(".tar.gz")
      ? outputPath
      : join(outputPath, `${newPackageName}.tar.gz`);

    mkdirSync(dirname(finalOutputPath), { recursive: true });

    await createTar(
      {
        gzip: true,
        file: finalOutputPath,
        cwd: stagingDir,
      },
      [newPackageName]
    );

    return finalOutputPath;
  } finally {
    // Cleanup
    rmSync(dirname(oldDir), { recursive: true });
    rmSync(deltaExtractDir, { recursive: true });
  }
}

/**
 * Read delta manifest from delta package
 */
export async function readDeltaManifest(
  deltaPath: string
): Promise<DeltaManifest> {
  const extractDir = join(tmpdir(), `cin-delta-read-${Date.now()}`);
  mkdirSync(extractDir, { recursive: true });

  try {
    await extractTar({ file: deltaPath, cwd: extractDir });

    const entries = readdirSync(extractDir);
    if (entries.length !== 1) {
      throw new Error("Invalid delta package");
    }

    const manifestPath = join(extractDir, entries[0], "delta-manifest.json");
    if (!existsSync(manifestPath)) {
      throw new Error("Delta manifest not found");
    }

    return JSON.parse(readFileSync(manifestPath, "utf-8"));
  } finally {
    rmSync(extractDir, { recursive: true });
  }
}
