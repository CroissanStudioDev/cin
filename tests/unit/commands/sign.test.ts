import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create as createTar } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateSigningKeyPair,
  getKeyId,
  getSignatureFilePath,
  saveKeyPair,
  signPackage,
} from "../../../src/lib/signing.js";

// Top-level regex constants
const KEY_ID_PATTERN = /^[a-f0-9]{16}$/;

describe("sign command logic", () => {
  let testDir: string;
  let packagePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `cin-sign-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create a test package
    const packageName = "sign-test-package";
    const stagingDir = join(testDir, "staging", packageName);
    mkdirSync(stagingDir, { recursive: true });

    writeFileSync(join(stagingDir, "file.txt"), "test content");
    writeFileSync(
      join(stagingDir, "manifest.json"),
      JSON.stringify({ package: { name: packageName } })
    );

    packagePath = join(testDir, `${packageName}.tar.gz`);
    await createTar(
      { gzip: true, file: packagePath, cwd: join(testDir, "staging") },
      [packageName]
    );
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("signPackage", () => {
    it("should sign package and create .sig file", () => {
      const keyPair = generateSigningKeyPair();
      const privateKeyPath = join(testDir, "signing-key.pem");
      const publicKeyPath = join(testDir, "signing-key.pub");
      saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

      const signatureInfo = signPackage(packagePath, privateKeyPath);

      expect(signatureInfo.algorithm).toBe("Ed25519");
      expect(signatureInfo.keyId).toMatch(KEY_ID_PATTERN);
      expect(signatureInfo.signature).toBeDefined();
      expect(signatureInfo.signedAt).toBeDefined();

      // Check .sig file created
      const sigPath = getSignatureFilePath(packagePath);
      expect(existsSync(sigPath)).toBe(true);
    });

    it("should use correct key ID derived from public key", () => {
      const keyPair = generateSigningKeyPair();
      const privateKeyPath = join(testDir, "signing-key.pem");
      const publicKeyPath = join(testDir, "signing-key.pub");
      saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

      const signatureInfo = signPackage(packagePath, privateKeyPath);
      const expectedKeyId = getKeyId(keyPair.publicKey);

      expect(signatureInfo.keyId).toBe(expectedKeyId);
    });

    it("should throw for non-existent package", () => {
      const keyPair = generateSigningKeyPair();
      const privateKeyPath = join(testDir, "signing-key.pem");
      const publicKeyPath = join(testDir, "signing-key.pub");
      saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

      expect(() =>
        signPackage(join(testDir, "nonexistent.tar.gz"), privateKeyPath)
      ).toThrow("Package not found");
    });

    it("should throw for non-existent key", () => {
      expect(() =>
        signPackage(packagePath, join(testDir, "nonexistent-key.pem"))
      ).toThrow("Private key not found");
    });
  });

  describe("getSignatureFilePath", () => {
    it("should return .sig path for package", () => {
      const sigPath = getSignatureFilePath("/path/to/package.tar.gz");
      expect(sigPath).toBe("/path/to/package.tar.gz.sig");
    });
  });

  describe("generateSigningKeyPair", () => {
    it("should generate unique key pairs", () => {
      const keyPair1 = generateSigningKeyPair();
      const keyPair2 = generateSigningKeyPair();

      expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
    });

    it("should generate PEM formatted keys", () => {
      const keyPair = generateSigningKeyPair();

      expect(keyPair.privateKey).toContain("-----BEGIN PRIVATE KEY-----");
      expect(keyPair.privateKey).toContain("-----END PRIVATE KEY-----");
      expect(keyPair.publicKey).toContain("-----BEGIN PUBLIC KEY-----");
      expect(keyPair.publicKey).toContain("-----END PUBLIC KEY-----");
    });
  });

  describe("saveKeyPair", () => {
    it("should save keys to files", () => {
      const keyPair = generateSigningKeyPair();
      const privateKeyPath = join(testDir, "keys", "signing-key.pem");
      const publicKeyPath = join(testDir, "keys", "signing-key.pub");

      saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

      expect(existsSync(privateKeyPath)).toBe(true);
      expect(existsSync(publicKeyPath)).toBe(true);
    });

    it("should create parent directories", () => {
      const keyPair = generateSigningKeyPair();
      const nestedPath = join(testDir, "deep", "nested", "keys");
      const privateKeyPath = join(nestedPath, "signing-key.pem");
      const publicKeyPath = join(nestedPath, "signing-key.pub");

      saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

      expect(existsSync(nestedPath)).toBe(true);
    });
  });

  describe("getKeyId", () => {
    it("should return consistent ID for same key", () => {
      const keyPair = generateSigningKeyPair();

      const id1 = getKeyId(keyPair.publicKey);
      const id2 = getKeyId(keyPair.publicKey);

      expect(id1).toBe(id2);
    });

    it("should return different IDs for different keys", () => {
      const keyPair1 = generateSigningKeyPair();
      const keyPair2 = generateSigningKeyPair();

      const id1 = getKeyId(keyPair1.publicKey);
      const id2 = getKeyId(keyPair2.publicKey);

      expect(id1).not.toBe(id2);
    });

    it("should return 16 character hex string", () => {
      const keyPair = generateSigningKeyPair();
      const keyId = getKeyId(keyPair.publicKey);

      expect(keyId).toMatch(KEY_ID_PATTERN);
    });
  });
});
