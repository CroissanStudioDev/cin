import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  derivePublicKey,
  generateSigningKeyPair,
  getKeyId,
  loadPrivateKey,
  loadPublicKey,
  saveKeyPair,
  signData,
  signPackage,
  verifyPackage,
  verifySignature,
} from "../../src/lib/signing.js";

// Top-level regex constants
const KEY_ID_PATTERN = /^[a-f0-9]{16}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+=*$/;

describe("signing", () => {
  let testDir: string;
  let keyPair: { privateKey: string; publicKey: string };

  beforeEach(() => {
    testDir = join(tmpdir(), `cin-signing-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    keyPair = generateSigningKeyPair();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("generateSigningKeyPair", () => {
    it("should generate a key pair with private and public keys", () => {
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();
    });

    it("should generate PEM formatted private key", () => {
      expect(keyPair.privateKey).toContain("-----BEGIN PRIVATE KEY-----");
      expect(keyPair.privateKey).toContain("-----END PRIVATE KEY-----");
    });

    it("should generate PEM formatted public key", () => {
      expect(keyPair.publicKey).toContain("-----BEGIN PUBLIC KEY-----");
      expect(keyPair.publicKey).toContain("-----END PUBLIC KEY-----");
    });

    it("should generate unique key pairs each time", () => {
      const keyPair2 = generateSigningKeyPair();
      expect(keyPair.privateKey).not.toBe(keyPair2.privateKey);
      expect(keyPair.publicKey).not.toBe(keyPair2.publicKey);
    });
  });

  describe("saveKeyPair / loadPrivateKey / loadPublicKey", () => {
    it("should save and load key pair correctly", () => {
      const privateKeyPath = join(testDir, "signing-key.pem");
      const publicKeyPath = join(testDir, "signing-key.pub");

      saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

      expect(existsSync(privateKeyPath)).toBe(true);
      expect(existsSync(publicKeyPath)).toBe(true);

      const loadedPrivate = loadPrivateKey(privateKeyPath);
      const loadedPublic = loadPublicKey(publicKeyPath);

      expect(loadedPrivate).toBe(keyPair.privateKey);
      expect(loadedPublic).toBe(keyPair.publicKey);
    });

    it("should throw error for non-existent private key", () => {
      expect(() => loadPrivateKey(join(testDir, "nonexistent.pem"))).toThrow(
        "Private key not found"
      );
    });

    it("should throw error for non-existent public key", () => {
      expect(() => loadPublicKey(join(testDir, "nonexistent.pub"))).toThrow(
        "Public key not found"
      );
    });

    it("should create directories if they dont exist", () => {
      const nestedDir = join(testDir, "nested", "keys");
      const privateKeyPath = join(nestedDir, "signing-key.pem");
      const publicKeyPath = join(nestedDir, "signing-key.pub");

      saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

      expect(existsSync(privateKeyPath)).toBe(true);
      expect(existsSync(publicKeyPath)).toBe(true);
    });
  });

  describe("getKeyId", () => {
    it("should return a 16 character hex string", () => {
      const keyId = getKeyId(keyPair.publicKey);
      expect(keyId).toMatch(KEY_ID_PATTERN);
    });

    it("should return consistent key ID for same public key", () => {
      const keyId1 = getKeyId(keyPair.publicKey);
      const keyId2 = getKeyId(keyPair.publicKey);
      expect(keyId1).toBe(keyId2);
    });

    it("should return different key IDs for different public keys", () => {
      const keyPair2 = generateSigningKeyPair();
      const keyId1 = getKeyId(keyPair.publicKey);
      const keyId2 = getKeyId(keyPair2.publicKey);
      expect(keyId1).not.toBe(keyId2);
    });
  });

  describe("derivePublicKey", () => {
    it("should derive public key from private key", () => {
      const derivedPublic = derivePublicKey(keyPair.privateKey);
      expect(derivedPublic).toBe(keyPair.publicKey);
    });
  });

  describe("signData / verifySignature", () => {
    it("should sign and verify data correctly", () => {
      const data = Buffer.from("test data to sign");
      const signature = signData(data, keyPair.privateKey);

      expect(signature).toBeDefined();
      expect(typeof signature).toBe("string");

      const isValid = verifySignature(data, signature, keyPair.publicKey);
      expect(isValid).toBe(true);
    });

    it("should return base64 encoded signature", () => {
      const data = Buffer.from("test");
      const signature = signData(data, keyPair.privateKey);

      // Base64 regex pattern
      expect(signature).toMatch(BASE64_PATTERN);
    });

    it("should fail verification with wrong public key", () => {
      const data = Buffer.from("test data");
      const signature = signData(data, keyPair.privateKey);

      const otherKeyPair = generateSigningKeyPair();
      const isValid = verifySignature(data, signature, otherKeyPair.publicKey);
      expect(isValid).toBe(false);
    });

    it("should fail verification with tampered data", () => {
      const data = Buffer.from("original data");
      const signature = signData(data, keyPair.privateKey);

      const tamperedData = Buffer.from("tampered data");
      const isValid = verifySignature(
        tamperedData,
        signature,
        keyPair.publicKey
      );
      expect(isValid).toBe(false);
    });

    it("should fail verification with invalid signature", () => {
      const data = Buffer.from("test data");
      const isValid = verifySignature(
        data,
        "invalid-signature",
        keyPair.publicKey
      );
      expect(isValid).toBe(false);
    });

    it("should handle empty data", () => {
      const data = Buffer.from("");
      const signature = signData(data, keyPair.privateKey);
      const isValid = verifySignature(data, signature, keyPair.publicKey);
      expect(isValid).toBe(true);
    });

    it("should handle large data", () => {
      const data = Buffer.alloc(1_000_000, "x");
      const signature = signData(data, keyPair.privateKey);
      const isValid = verifySignature(data, signature, keyPair.publicKey);
      expect(isValid).toBe(true);
    });
  });

  describe("signPackage / verifyPackage", () => {
    it("should sign and verify package correctly", () => {
      const packagePath = join(testDir, "package.tar.gz");
      const privateKeyPath = join(testDir, "signing-key.pem");
      const publicKeyPath = join(testDir, "signing-key.pub");

      writeFileSync(packagePath, "fake package content");
      saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

      const signatureInfo = signPackage(packagePath, privateKeyPath);

      expect(signatureInfo.algorithm).toBe("Ed25519");
      expect(signatureInfo.keyId).toMatch(KEY_ID_PATTERN);
      expect(signatureInfo.signature).toBeDefined();
      expect(signatureInfo.signedAt).toBeDefined();

      // Signature file should be created
      expect(existsSync(`${packagePath}.sig`)).toBe(true);

      // Verify the package
      const result = verifyPackage(packagePath, publicKeyPath);
      expect(result.valid).toBe(true);
      expect(result.signatureInfo).toBeDefined();
    });

    it("should fail verification with wrong public key", () => {
      const packagePath = join(testDir, "package.tar.gz");
      const privateKeyPath = join(testDir, "signing-key.pem");
      const publicKeyPath = join(testDir, "signing-key.pub");
      const wrongPublicKeyPath = join(testDir, "wrong-key.pub");

      writeFileSync(packagePath, "fake package content");
      saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

      const otherKeyPair = generateSigningKeyPair();
      writeFileSync(wrongPublicKeyPath, otherKeyPair.publicKey);

      signPackage(packagePath, privateKeyPath);

      const result = verifyPackage(packagePath, wrongPublicKeyPath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Key ID mismatch");
    });

    it("should fail verification for tampered package", () => {
      const packagePath = join(testDir, "package.tar.gz");
      const privateKeyPath = join(testDir, "signing-key.pem");
      const publicKeyPath = join(testDir, "signing-key.pub");

      writeFileSync(packagePath, "original content");
      saveKeyPair(keyPair, privateKeyPath, publicKeyPath);

      signPackage(packagePath, privateKeyPath);

      // Tamper with the package
      writeFileSync(packagePath, "tampered content");

      const result = verifyPackage(packagePath, publicKeyPath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Signature verification failed");
    });

    it("should fail for non-existent package", () => {
      expect(() =>
        signPackage(join(testDir, "nonexistent.tar.gz"), "key.pem")
      ).toThrow("Package not found");
    });

    it("should fail verification without signature file", () => {
      const packagePath = join(testDir, "unsigned.tar.gz");
      const publicKeyPath = join(testDir, "signing-key.pub");

      writeFileSync(packagePath, "unsigned content");
      writeFileSync(publicKeyPath, keyPair.publicKey);

      const result = verifyPackage(packagePath, publicKeyPath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("No signature file found");
    });
  });
});
