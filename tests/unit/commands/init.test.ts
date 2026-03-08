import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getProjectConfigPath,
  initProjectConfig,
  projectConfigExists,
  setConfigPath,
} from "../../../src/lib/config.js";

describe("init command logic", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cin-init-test-${Date.now()}`);
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

  describe("initProjectConfig", () => {
    it("should create project config with defaults", () => {
      const config = initProjectConfig({}, testDir);

      expect(config.version).toBe(1);
      expect(config.project).toBeDefined();
      expect(config.project.type).toBe("docker-compose");
      expect(config.repositories).toEqual([]);
    });

    it("should create config file on disk", () => {
      initProjectConfig({}, testDir);

      const configPath = getProjectConfigPath(testDir);
      expect(existsSync(configPath)).toBe(true);

      const content = readFileSync(configPath, "utf-8");
      expect(content).toContain("version: 1");
      expect(content).toContain("docker-compose");
    });

    it("should create .cin directory", () => {
      initProjectConfig({}, testDir);

      const cinDir = join(testDir, ".cin");
      expect(existsSync(cinDir)).toBe(true);
    });

    it("should accept custom project name", () => {
      const config = initProjectConfig(
        {
          project: { name: "my-project", type: "docker-compose" },
        },
        testDir
      );

      expect(config.project.name).toBe("my-project");
    });

    it("should accept vendor information", () => {
      const config = initProjectConfig(
        {
          vendor: { name: "Croissan Studio", contact: "hello@croissan.dev" },
        },
        testDir
      );

      expect(config.vendor.name).toBe("Croissan Studio");
      expect(config.vendor.contact).toBe("hello@croissan.dev");
    });
  });

  describe("projectConfigExists", () => {
    it("should return false for empty directory", () => {
      expect(projectConfigExists(testDir)).toBe(false);
    });

    it("should return true after init", () => {
      initProjectConfig({}, testDir);
      expect(projectConfigExists(testDir)).toBe(true);
    });
  });

  describe("keys directory", () => {
    it("should have .cin directory after initProjectConfig", () => {
      initProjectConfig({}, testDir);

      // Note: initProjectConfig creates .cin dir but not keys subdir
      // The init command creates keys dir separately
      const cinDir = join(testDir, ".cin");
      expect(existsSync(cinDir)).toBe(true);
    });
  });
});
