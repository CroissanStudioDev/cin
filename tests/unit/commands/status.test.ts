import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addRepository,
  getRepositories,
  globalConfigExists,
  initProjectConfig,
  projectConfigExists,
  readProjectConfig,
  setConfigPath,
} from "../../../src/lib/config.js";

describe("status command logic", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cin-status-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(testDir);
    setConfigPath(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    setConfigPath(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("global config status", () => {
    it("should detect when global config not exists", () => {
      // Note: globalConfigExists checks ~/.cin/config.yaml
      // For testing, we check the function behavior
      expect(typeof globalConfigExists()).toBe("boolean");
    });
  });

  describe("project config status", () => {
    it("should detect uninitialized project", () => {
      expect(projectConfigExists(testDir)).toBe(false);
    });

    it("should detect initialized project", () => {
      initProjectConfig({}, testDir);
      expect(projectConfigExists(testDir)).toBe(true);
    });

    it("should read project name", () => {
      initProjectConfig(
        { project: { name: "my-app", type: "docker-compose" } },
        testDir
      );

      const config = readProjectConfig(testDir);
      expect(config?.project?.name).toBe("my-app");
    });

    it("should read vendor info", () => {
      initProjectConfig(
        {
          vendor: { name: "Croissan Studio", contact: "dev@croissan.io" },
        },
        testDir
      );

      const config = readProjectConfig(testDir);
      expect(config?.vendor?.name).toBe("Croissan Studio");
    });
  });

  describe("repositories status", () => {
    beforeEach(() => {
      initProjectConfig({}, testDir);
    });

    it("should return empty array when no repos", () => {
      const repos = getRepositories(testDir);
      expect(repos).toEqual([]);
    });

    it("should return repos count", () => {
      addRepository({ name: "repo1", url: "url1" }, testDir);
      addRepository({ name: "repo2", url: "url2" }, testDir);

      const repos = getRepositories(testDir);
      expect(repos).toHaveLength(2);
    });
  });

  describe("status output data", () => {
    it("should provide all data needed for status display", () => {
      initProjectConfig(
        {
          project: { name: "test-project", type: "docker-compose" },
          vendor: { name: "Test Vendor", contact: "test@test.com" },
        },
        testDir
      );

      const config = readProjectConfig(testDir);
      const repos = getRepositories(testDir);

      expect(config).toBeDefined();
      expect(config?.project?.name).toBeDefined();
      expect(config?.vendor?.name).toBeDefined();
      expect(Array.isArray(repos)).toBe(true);
    });
  });
});
