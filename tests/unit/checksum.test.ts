import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checksumFile, checksumString } from "../../src/utils/checksum.js";

// Top-level regex constants
const SHA256_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

// Known SHA256 of empty string
const EMPTY_STRING_SHA256 =
  "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("checksum", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cin-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Cleanup handled by OS temp directory
  });

  describe("checksumString", () => {
    it("should return sha256 prefixed hash", () => {
      const result = checksumString("hello");
      expect(result).toMatch(SHA256_HASH_PATTERN);
    });

    it("should return consistent hash for same input", () => {
      const hash1 = checksumString("test content");
      const hash2 = checksumString("test content");
      expect(hash1).toBe(hash2);
    });

    it("should return different hash for different input", () => {
      const hash1 = checksumString("content1");
      const hash2 = checksumString("content2");
      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty string", () => {
      const result = checksumString("");
      expect(result).toMatch(SHA256_HASH_PATTERN);
      expect(result).toBe(EMPTY_STRING_SHA256);
    });

    it("should handle unicode characters", () => {
      const result = checksumString("привет мир 你好世界");
      expect(result).toMatch(SHA256_HASH_PATTERN);
    });

    it("should handle large strings", () => {
      const largeString = "x".repeat(1_000_000);
      const result = checksumString(largeString);
      expect(result).toMatch(SHA256_HASH_PATTERN);
    });
  });

  describe("checksumFile", () => {
    it("should return sha256 prefixed hash for file", async () => {
      const filePath = join(testDir, "test.txt");
      writeFileSync(filePath, "hello world");

      const result = await checksumFile(filePath);
      expect(result).toMatch(SHA256_HASH_PATTERN);
    });

    it("should return consistent hash for same file content", async () => {
      const file1 = join(testDir, "file1.txt");
      const file2 = join(testDir, "file2.txt");
      writeFileSync(file1, "same content");
      writeFileSync(file2, "same content");

      const hash1 = await checksumFile(file1);
      const hash2 = await checksumFile(file2);
      expect(hash1).toBe(hash2);
    });

    it("should return different hash for different file content", async () => {
      const file1 = join(testDir, "file1.txt");
      const file2 = join(testDir, "file2.txt");
      writeFileSync(file1, "content one");
      writeFileSync(file2, "content two");

      const hash1 = await checksumFile(file1);
      const hash2 = await checksumFile(file2);
      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty file", async () => {
      const filePath = join(testDir, "empty.txt");
      writeFileSync(filePath, "");

      const result = await checksumFile(filePath);
      expect(result).toBe(EMPTY_STRING_SHA256);
    });

    it("should handle binary file", async () => {
      const filePath = join(testDir, "binary.bin");
      const buffer = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      writeFileSync(filePath, buffer);

      const result = await checksumFile(filePath);
      expect(result).toMatch(SHA256_HASH_PATTERN);
    });

    it("should reject for non-existent file", async () => {
      const filePath = join(testDir, "nonexistent.txt");
      await expect(checksumFile(filePath)).rejects.toThrow();
    });

    it("should match checksumString for same content", async () => {
      const content = "matching content test";
      const filePath = join(testDir, "match.txt");
      writeFileSync(filePath, content);

      const fileHash = await checksumFile(filePath);
      const stringHash = checksumString(content);
      expect(fileHash).toBe(stringHash);
    });
  });
});
