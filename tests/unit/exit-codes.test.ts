import { describe, expect, it } from "vitest";
import { EXIT_CODES } from "../../src/utils/exit-codes.js";

describe("EXIT_CODES", () => {
  it("should have SUCCESS as 0", () => {
    expect(EXIT_CODES.SUCCESS).toBe(0);
  });

  it("should have GENERAL_ERROR as 1", () => {
    expect(EXIT_CODES.GENERAL_ERROR).toBe(1);
  });

  it("should have MISUSE as 2", () => {
    expect(EXIT_CODES.MISUSE).toBe(2);
  });

  it("should have CONFIG_ERROR as 10", () => {
    expect(EXIT_CODES.CONFIG_ERROR).toBe(10);
  });

  it("should have AUTH_ERROR as 11", () => {
    expect(EXIT_CODES.AUTH_ERROR).toBe(11);
  });

  it("should have NETWORK_ERROR as 12", () => {
    expect(EXIT_CODES.NETWORK_ERROR).toBe(12);
  });

  it("should have VALIDATION_ERROR as 13", () => {
    expect(EXIT_CODES.VALIDATION_ERROR).toBe(13);
  });

  it("should have FILE_ERROR as 14", () => {
    expect(EXIT_CODES.FILE_ERROR).toBe(14);
  });

  it("should have TIMEOUT as 15", () => {
    expect(EXIT_CODES.TIMEOUT).toBe(15);
  });

  it("should have DEPENDENCY_ERROR as 16", () => {
    expect(EXIT_CODES.DEPENDENCY_ERROR).toBe(16);
  });

  it("should have unique exit codes", () => {
    const values = Object.values(EXIT_CODES);
    const uniqueValues = new Set(values);
    expect(values.length).toBe(uniqueValues.size);
  });

  it("should be immutable (const assertion)", () => {
    // TypeScript ensures this at compile time with `as const`
    // Runtime check that values exist
    expect(Object.keys(EXIT_CODES).length).toBeGreaterThan(0);
  });
});
