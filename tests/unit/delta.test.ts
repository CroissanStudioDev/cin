import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create as createTar } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyDelta,
  createDelta,
  type DeltaManifest,
  readDeltaManifest,
} from "../../src/lib/delta.js";

// Top-level regex constants
const SHA256_PREFIX_PATTERN = /^sha256:/;

describe("delta", () => {
  let testDir: string;
  let oldPackagePath: string;
  let newPackagePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `cin-delta-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create old package
    const oldDir = join(testDir, "staging-old", "test-package-v1");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "file1.txt"), "original content 1");
    writeFileSync(join(oldDir, "file2.txt"), "original content 2");
    writeFileSync(join(oldDir, "to-delete.txt"), "will be deleted");
    writeFileSync(
      join(oldDir, "manifest.json"),
      JSON.stringify({
        package: { name: "test-package-v1" },
        checksums: {
          "file1.txt": "sha256:old1",
          "file2.txt": "sha256:old2",
          "to-delete.txt": "sha256:old3",
        },
      })
    );

    oldPackagePath = join(testDir, "test-package-v1.tar.gz");
    await createTar(
      { gzip: true, file: oldPackagePath, cwd: join(testDir, "staging-old") },
      ["test-package-v1"]
    );

    // Create new package
    const newDir = join(testDir, "staging-new", "test-package-v2");
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(newDir, "file1.txt"), "modified content 1");
    writeFileSync(join(newDir, "file2.txt"), "original content 2");
    writeFileSync(join(newDir, "file3.txt"), "new file content");
    writeFileSync(
      join(newDir, "manifest.json"),
      JSON.stringify({
        package: { name: "test-package-v2" },
        checksums: {
          "file1.txt": "sha256:new1",
          "file2.txt": "sha256:old2",
          "file3.txt": "sha256:new3",
        },
      })
    );

    newPackagePath = join(testDir, "test-package-v2.tar.gz");
    await createTar(
      { gzip: true, file: newPackagePath, cwd: join(testDir, "staging-new") },
      ["test-package-v2"]
    );
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("createDelta", () => {
    it("should create delta package", async () => {
      const outputPath = join(testDir, "output");
      mkdirSync(outputPath, { recursive: true });

      const { deltaPath } = await createDelta(
        oldPackagePath,
        newPackagePath,
        outputPath
      );

      expect(existsSync(deltaPath)).toBe(true);
      expect(deltaPath).toContain(".tar.gz");
    });

    it("should detect added files", async () => {
      const outputPath = join(testDir, "delta.tar.gz");

      const { stats } = await createDelta(
        oldPackagePath,
        newPackagePath,
        outputPath
      );

      expect(stats.added).toBe(1); // file3.txt
    });

    it("should detect modified files", async () => {
      const outputPath = join(testDir, "delta.tar.gz");

      const { stats } = await createDelta(
        oldPackagePath,
        newPackagePath,
        outputPath
      );

      expect(stats.modified).toBe(1); // file1.txt
    });

    it("should detect removed files", async () => {
      const outputPath = join(testDir, "delta.tar.gz");

      const { stats } = await createDelta(
        oldPackagePath,
        newPackagePath,
        outputPath
      );

      expect(stats.removed).toBe(1); // to-delete.txt
    });

    it("should calculate size savings", async () => {
      const outputPath = join(testDir, "delta.tar.gz");

      const { stats } = await createDelta(
        oldPackagePath,
        newPackagePath,
        outputPath
      );

      expect(stats.oldSize).toBeGreaterThan(0);
      expect(stats.newSize).toBeGreaterThan(0);
      expect(stats.deltaSize).toBeGreaterThan(0);
      expect(stats.savedBytes).toBeDefined();
      expect(stats.savedPercent).toBeDefined();
    });
  });

  describe("readDeltaManifest", () => {
    it("should read delta manifest from package", async () => {
      const outputPath = join(testDir, "delta.tar.gz");
      await createDelta(oldPackagePath, newPackagePath, outputPath);

      const manifest = await readDeltaManifest(outputPath);

      expect(manifest.version).toBe("1.0");
      expect(manifest.basePackage).toBeDefined();
      expect(manifest.targetPackage).toBeDefined();
      expect(manifest.added).toContain("file3.txt");
      expect(manifest.modified).toContain("file1.txt");
      expect(manifest.removed).toContain("to-delete.txt");
    });

    it("should include package names in manifest", async () => {
      const outputPath = join(testDir, "delta.tar.gz");
      await createDelta(oldPackagePath, newPackagePath, outputPath);

      const manifest = await readDeltaManifest(outputPath);

      expect(manifest.basePackage.name).toBe("test-package-v1");
      expect(manifest.targetPackage.name).toBe("test-package-v2");
    });

    it("should include checksums in manifest", async () => {
      const outputPath = join(testDir, "delta.tar.gz");
      await createDelta(oldPackagePath, newPackagePath, outputPath);

      const manifest = await readDeltaManifest(outputPath);

      expect(manifest.basePackage.checksum).toMatch(SHA256_PREFIX_PATTERN);
      expect(manifest.targetPackage.checksum).toMatch(SHA256_PREFIX_PATTERN);
    });
  });

  describe("applyDelta", () => {
    it("should apply delta to create new package", async () => {
      const deltaPath = join(testDir, "delta.tar.gz");
      await createDelta(oldPackagePath, newPackagePath, deltaPath);

      const outputPath = join(testDir, "applied");
      mkdirSync(outputPath, { recursive: true });

      const resultPath = await applyDelta(
        oldPackagePath,
        deltaPath,
        outputPath
      );

      expect(existsSync(resultPath)).toBe(true);
      expect(resultPath).toContain("test-package-v2");
    });

    it("should throw on base package mismatch", async () => {
      // Create delta from v1 to v2
      const deltaPath = join(testDir, "delta.tar.gz");
      await createDelta(oldPackagePath, newPackagePath, deltaPath);

      // Try to apply to a different base (v2 instead of v1)
      const outputPath = join(testDir, "applied");
      mkdirSync(outputPath, { recursive: true });

      await expect(
        applyDelta(newPackagePath, deltaPath, outputPath)
      ).rejects.toThrow("Base package mismatch");
    });
  });

  describe("DeltaManifest structure", () => {
    it("should have correct structure", () => {
      const manifest: DeltaManifest = {
        version: "1.0",
        created: new Date().toISOString(),
        basePackage: {
          name: "package-v1",
          checksum: "sha256:abc123",
        },
        targetPackage: {
          name: "package-v2",
          checksum: "sha256:def456",
        },
        added: ["new-file.txt"],
        modified: ["changed-file.txt"],
        removed: ["deleted-file.txt"],
      };

      expect(manifest.version).toBe("1.0");
      expect(manifest.basePackage.name).toBe("package-v1");
      expect(manifest.added).toContain("new-file.txt");
    });
  });

  describe("edge cases", () => {
    it("should handle packages with no changes", async () => {
      // Create identical packages
      const identicalDir = join(testDir, "staging-same", "same-package");
      mkdirSync(identicalDir, { recursive: true });
      writeFileSync(join(identicalDir, "file.txt"), "content");
      writeFileSync(
        join(identicalDir, "manifest.json"),
        JSON.stringify({
          package: { name: "same-package" },
          checksums: { "file.txt": "sha256:same" },
        })
      );

      const samePath = join(testDir, "same.tar.gz");
      await createTar(
        { gzip: true, file: samePath, cwd: join(testDir, "staging-same") },
        ["same-package"]
      );

      const outputPath = join(testDir, "no-change-delta.tar.gz");
      const { stats } = await createDelta(samePath, samePath, outputPath);

      expect(stats.added).toBe(0);
      expect(stats.modified).toBe(0);
      expect(stats.removed).toBe(0);
    });

    it("should throw for package without manifest", async () => {
      // Create package without manifest
      const noManifestDir = join(testDir, "staging-no-manifest", "bad-package");
      mkdirSync(noManifestDir, { recursive: true });
      writeFileSync(join(noManifestDir, "file.txt"), "content");

      const badPath = join(testDir, "bad.tar.gz");
      await createTar(
        {
          gzip: true,
          file: badPath,
          cwd: join(testDir, "staging-no-manifest"),
        },
        ["bad-package"]
      );

      const outputPath = join(testDir, "delta.tar.gz");
      await expect(
        createDelta(oldPackagePath, badPath, outputPath)
      ).rejects.toThrow("manifest");
    });
  });
});
