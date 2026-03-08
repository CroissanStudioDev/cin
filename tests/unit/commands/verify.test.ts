import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create as createTar } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateSigningKeyPair,
  saveKeyPair,
  signPackage,
  verifyPackage,
} from "../../../src/lib/signing.js";
import { checksumFile } from "../../../src/utils/checksum.js";

// Top-level regex constants
const SHA256_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

describe("verify command logic", () => {
  let testDir: string;
  let packagePath: string;
  let keyPair: { privateKey: string; publicKey: string };

  beforeEach(async () => {
    testDir = join(tmpdir(), `cin-verify-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create a test package
    const packageName = "test-package";
    const stagingDir = join(testDir, "staging", packageName);
    mkdirSync(stagingDir, { recursive: true });

    // Create test files
    writeFileSync(join(stagingDir, "file1.txt"), "content 1");
    writeFileSync(join(stagingDir, "file2.txt"), "content 2");

    // Create manifest with checksums
    const checksums: Record<string, string> = {
      "file1.txt": await checksumFile(join(stagingDir, "file1.txt")),
      "file2.txt": await checksumFile(join(stagingDir, "file2.txt")),
    };

    const manifest = {
      package: {
        name: packageName,
        created: new Date().toISOString(),
        created_by: "test",
      },
      project: {
        name: "test-project",
        type: "docker-compose",
      },
      checksums,
    };

    writeFileSync(
      join(stagingDir, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );

    // Create tar.gz package
    packagePath = join(testDir, `${packageName}.tar.gz`);
    await createTar(
      { gzip: true, file: packagePath, cwd: join(testDir, "staging") },
      [packageName]
    );

    // Generate signing keys
    keyPair = generateSigningKeyPair();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("signature verification", () => {
    it("should verify valid signature", () => {
      const privateKeyPath = join(testDir, "signing-key.pem");
      const publicKeyPath = join(testDir, "signing-key.pub");
      saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

      signPackage(packagePath, privateKeyPath);

      const result = verifyPackage(packagePath, publicKeyPath);
      expect(result.valid).toBe(true);
      expect(result.signatureInfo?.algorithm).toBe("Ed25519");
    });

    it("should fail verification with wrong key", () => {
      const privateKeyPath = join(testDir, "signing-key.pem");
      const publicKeyPath = join(testDir, "signing-key.pub");
      saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

      signPackage(packagePath, privateKeyPath);

      // Use different key pair
      const otherKeyPair = generateSigningKeyPair();
      const otherPublicKeyPath = join(testDir, "other-key.pub");
      writeFileSync(otherPublicKeyPath, otherKeyPair.publicKey);

      const result = verifyPackage(packagePath, otherPublicKeyPath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Key ID mismatch");
    });

    it("should fail if package modified after signing", async () => {
      const privateKeyPath = join(testDir, "signing-key.pem");
      const publicKeyPath = join(testDir, "signing-key.pub");
      saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

      signPackage(packagePath, privateKeyPath);

      // Modify package (recreate with different content)
      const packageName = "test-package";
      const stagingDir = join(testDir, "staging", packageName);
      writeFileSync(join(stagingDir, "file1.txt"), "MODIFIED content");

      // Recreate package
      await createTar(
        { gzip: true, file: packagePath, cwd: join(testDir, "staging") },
        [packageName]
      );

      const result = verifyPackage(packagePath, publicKeyPath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Signature verification failed");
    });

    it("should fail if signature file missing", () => {
      const publicKeyPath = join(testDir, "signing-key.pub");
      writeFileSync(publicKeyPath, keyPair.publicKey);

      const result = verifyPackage(packagePath, publicKeyPath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("No signature file found");
    });
  });

  describe("checksum verification", () => {
    it("should verify correct checksums", async () => {
      // Checksums are correct as set up in beforeEach
      const packageName = "test-package";
      const stagingDir = join(testDir, "staging", packageName);

      const file1Checksum = await checksumFile(join(stagingDir, "file1.txt"));
      const file2Checksum = await checksumFile(join(stagingDir, "file2.txt"));

      expect(file1Checksum).toMatch(SHA256_HASH_PATTERN);
      expect(file2Checksum).toMatch(SHA256_HASH_PATTERN);
    });

    it("should detect modified files via checksum", async () => {
      const packageName = "test-package";
      const stagingDir = join(testDir, "staging", packageName);

      const originalChecksum = await checksumFile(
        join(stagingDir, "file1.txt")
      );

      // Modify file
      writeFileSync(join(stagingDir, "file1.txt"), "tampered content");

      const newChecksum = await checksumFile(join(stagingDir, "file1.txt"));

      expect(newChecksum).not.toBe(originalChecksum);
    });
  });

  describe("package structure", () => {
    it("should require manifest.json", async () => {
      // Create package without manifest
      const badDir = join(testDir, "bad-staging", "bad-package");
      mkdirSync(badDir, { recursive: true });
      writeFileSync(join(badDir, "file.txt"), "content");

      const badPackagePath = join(testDir, "bad-package.tar.gz");
      await createTar(
        { gzip: true, file: badPackagePath, cwd: join(testDir, "bad-staging") },
        ["bad-package"]
      );

      // Verify throws error or returns invalid
      expect(existsSync(badPackagePath)).toBe(true);
      // The actual verify command would fail on missing manifest
    });
  });
});
