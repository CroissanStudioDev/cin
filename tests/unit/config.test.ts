import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addRepository,
  getConfigCwd,
  getProjectConfigPath,
  getRepositories,
  initProjectConfig,
  type ProjectConfig,
  projectConfigExists,
  type Repository,
  readProjectConfig,
  removeRepository,
  resolveSshKey,
  setConfigPath,
  writeProjectConfig,
} from "../../src/lib/config.js";

describe("config", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cin-config-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(testDir);
    // Reset custom config path
    setConfigPath(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    setConfigPath(originalCwd); // Reset
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("setConfigPath / getConfigCwd", () => {
    it("should set and get custom config path", () => {
      const customPath = "/custom/path";
      setConfigPath(customPath);
      expect(getConfigCwd()).toBe(customPath);
    });
  });

  describe("getProjectConfigPath", () => {
    it("should return path to project config", () => {
      const configPath = getProjectConfigPath(testDir);
      expect(configPath).toBe(join(testDir, ".cin", "config.yaml"));
    });
  });

  describe("projectConfigExists", () => {
    it("should return false when config does not exist", () => {
      expect(projectConfigExists(testDir)).toBe(false);
    });

    it("should return true when config exists", () => {
      initProjectConfig({}, testDir);
      expect(projectConfigExists(testDir)).toBe(true);
    });
  });

  describe("initProjectConfig", () => {
    it("should create project config with defaults", () => {
      const config = initProjectConfig({}, testDir);

      expect(config.version).toBe(1);
      expect(config.project).toBeDefined();
      expect(config.project.type).toBe("docker-compose");
      expect(config.repositories).toEqual([]);
    });

    it("should create config with overrides", () => {
      const config = initProjectConfig(
        {
          project: { name: "test-project", type: "docker-compose" },
          vendor: { name: "Test Vendor", contact: "test@test.com" },
        },
        testDir
      );

      expect(config.project.name).toBe("test-project");
      expect(config.vendor.name).toBe("Test Vendor");
    });

    it("should create .cin directory", () => {
      initProjectConfig({}, testDir);
      expect(existsSync(join(testDir, ".cin"))).toBe(true);
    });
  });

  describe("readProjectConfig / writeProjectConfig", () => {
    it("should write and read project config", () => {
      const config: ProjectConfig = {
        version: 1,
        project: { name: "test", type: "docker-compose" },
        vendor: { name: "Test", contact: "test@test.com" },
        repositories: [],
      };

      writeProjectConfig(config, testDir);
      const readConfig = readProjectConfig(testDir);

      expect(readConfig).toEqual(config);
    });

    it("should return null for non-existent config", () => {
      const config = readProjectConfig(testDir);
      expect(config).toBeNull();
    });
  });

  describe("addRepository / removeRepository / getRepositories", () => {
    beforeEach(() => {
      initProjectConfig({}, testDir);
    });

    it("should add repository", () => {
      const repo: Repository = {
        name: "test-repo",
        url: "https://github.com/test/repo.git",
        branch: "main",
      };

      addRepository(repo, testDir);
      const repos = getRepositories(testDir);

      expect(repos).toHaveLength(1);
      expect(repos[0].name).toBe("test-repo");
      expect(repos[0].url).toBe("https://github.com/test/repo.git");
    });

    it("should throw error when adding duplicate repository", () => {
      const repo: Repository = {
        name: "test-repo",
        url: "https://github.com/test/repo.git",
      };

      addRepository(repo, testDir);

      expect(() => addRepository(repo, testDir)).toThrow(
        "Repository 'test-repo' already exists"
      );
    });

    it("should remove repository", () => {
      const repo: Repository = {
        name: "test-repo",
        url: "https://github.com/test/repo.git",
      };

      addRepository(repo, testDir);
      removeRepository("test-repo", testDir);

      const repos = getRepositories(testDir);
      expect(repos).toHaveLength(0);
    });

    it("should throw error when removing non-existent repository", () => {
      expect(() => removeRepository("nonexistent", testDir)).toThrow(
        "Repository 'nonexistent' not found"
      );
    });

    it("should throw error when project not initialized", () => {
      const emptyDir = join(testDir, "empty");
      mkdirSync(emptyDir);

      expect(() =>
        addRepository({ name: "test", url: "url" }, emptyDir)
      ).toThrow("Project not initialized");
    });
  });

  describe("resolveSshKey", () => {
    beforeEach(() => {
      initProjectConfig({}, testDir);
    });

    it("should resolve absolute path", () => {
      const keyPath = join(testDir, "test-key");
      writeFileSync(keyPath, "fake key content");

      const resolved = resolveSshKey(keyPath, testDir);
      expect(resolved).toBe(keyPath);
    });

    it("should resolve relative path", () => {
      const keyPath = join(testDir, "relative-key");
      writeFileSync(keyPath, "fake key content");

      const resolved = resolveSshKey("relative-key", testDir);
      expect(resolved).toBe(keyPath);
    });

    it("should resolve key from .cin/keys directory", () => {
      const keysDir = join(testDir, ".cin", "keys");
      mkdirSync(keysDir, { recursive: true });
      const keyPath = join(keysDir, "project-key");
      writeFileSync(keyPath, "fake key content");

      const resolved = resolveSshKey("project-key", testDir);
      expect(resolved).toBe(keyPath);
    });

    it("should return null for non-existent key", () => {
      const resolved = resolveSshKey("nonexistent-key", testDir);
      expect(resolved).toBeNull();
    });
  });
});

describe("config - Repository operations", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cin-repo-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(testDir);
    setConfigPath(testDir);
    initProjectConfig({}, testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    setConfigPath(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should support multiple repositories", () => {
    addRepository({ name: "repo1", url: "url1" }, testDir);
    addRepository({ name: "repo2", url: "url2" }, testDir);
    addRepository({ name: "repo3", url: "url3" }, testDir);

    const repos = getRepositories(testDir);
    expect(repos).toHaveLength(3);
  });

  it("should preserve repository order", () => {
    addRepository({ name: "alpha", url: "url1" }, testDir);
    addRepository({ name: "beta", url: "url2" }, testDir);
    addRepository({ name: "gamma", url: "url3" }, testDir);

    const repos = getRepositories(testDir);
    expect(repos[0].name).toBe("alpha");
    expect(repos[1].name).toBe("beta");
    expect(repos[2].name).toBe("gamma");
  });

  it("should store ssh_key configuration", () => {
    addRepository({ name: "repo", url: "url", ssh_key: "deploy-key" }, testDir);

    const repos = getRepositories(testDir);
    expect(repos[0].ssh_key).toBe("deploy-key");
  });

  it("should store branch configuration", () => {
    addRepository({ name: "repo", url: "url", branch: "develop" }, testDir);

    const repos = getRepositories(testDir);
    expect(repos[0].branch).toBe("develop");
  });

  it("should store submodules configuration", () => {
    addRepository(
      {
        name: "repo",
        url: "url",
        submodules: [{ path: "libs/shared", ssh_key: "lib-key" }],
      },
      testDir
    );

    const repos = getRepositories(testDir);
    expect(repos[0].submodules).toHaveLength(1);
    expect(repos[0].submodules?.[0].path).toBe("libs/shared");
  });
});
