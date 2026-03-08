import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addRepository,
  getRepositories,
  initProjectConfig,
  removeRepository,
  setConfigPath,
} from "../../../src/lib/config.js";

// Top-level regex constants for URL name extraction
const REPO_NAME_SLASH_PATTERN = /\/([^/]+?)(?:\.git)?$/;
const REPO_NAME_COLON_PATTERN = /:([^/]+?)(?:\.git)?$/;

describe("repo command logic", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cin-repo-cmd-test-${Date.now()}`);
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

  describe("repo add", () => {
    it("should add repository with URL", () => {
      addRepository(
        {
          name: "backend",
          url: "git@github.com:studio/backend.git",
          branch: "main",
        },
        testDir
      );

      const repos = getRepositories(testDir);
      expect(repos).toHaveLength(1);
      expect(repos[0].name).toBe("backend");
      expect(repos[0].url).toBe("git@github.com:studio/backend.git");
    });

    it("should add repository with SSH key", () => {
      addRepository(
        {
          name: "frontend",
          url: "git@github.com:studio/frontend.git",
          branch: "develop",
          ssh_key: "deploy-key",
        },
        testDir
      );

      const repos = getRepositories(testDir);
      expect(repos[0].ssh_key).toBe("deploy-key");
      expect(repos[0].branch).toBe("develop");
    });

    it("should add repository with submodules config", () => {
      addRepository(
        {
          name: "monorepo",
          url: "git@github.com:studio/monorepo.git",
          submodules: [
            { path: "libs/shared", ssh_key: "shared-key" },
            { path: "libs/common" },
          ],
        },
        testDir
      );

      const repos = getRepositories(testDir);
      expect(repos[0].submodules).toHaveLength(2);
      expect(repos[0].submodules?.[0].path).toBe("libs/shared");
      expect(repos[0].submodules?.[0].ssh_key).toBe("shared-key");
    });

    it("should reject duplicate repository names", () => {
      addRepository({ name: "api", url: "url1" }, testDir);

      expect(() =>
        addRepository({ name: "api", url: "url2" }, testDir)
      ).toThrow("Repository 'api' already exists");
    });

    it("should support multiple repositories", () => {
      addRepository({ name: "repo1", url: "url1" }, testDir);
      addRepository({ name: "repo2", url: "url2" }, testDir);
      addRepository({ name: "repo3", url: "url3" }, testDir);

      const repos = getRepositories(testDir);
      expect(repos).toHaveLength(3);
    });
  });

  describe("repo list", () => {
    it("should return empty array initially", () => {
      const repos = getRepositories(testDir);
      expect(repos).toEqual([]);
    });

    it("should return all repositories in order", () => {
      addRepository({ name: "alpha", url: "url1" }, testDir);
      addRepository({ name: "beta", url: "url2" }, testDir);
      addRepository({ name: "gamma", url: "url3" }, testDir);

      const repos = getRepositories(testDir);
      expect(repos[0].name).toBe("alpha");
      expect(repos[1].name).toBe("beta");
      expect(repos[2].name).toBe("gamma");
    });
  });

  describe("repo remove", () => {
    it("should remove repository by name", () => {
      addRepository({ name: "to-remove", url: "url" }, testDir);
      addRepository({ name: "to-keep", url: "url2" }, testDir);

      removeRepository("to-remove", testDir);

      const repos = getRepositories(testDir);
      expect(repos).toHaveLength(1);
      expect(repos[0].name).toBe("to-keep");
    });

    it("should throw for non-existent repository", () => {
      expect(() => removeRepository("nonexistent", testDir)).toThrow(
        "Repository 'nonexistent' not found"
      );
    });
  });

  describe("URL name extraction", () => {
    // Test the name extraction logic that repo add uses
    const extractRepoName = (url: string): string => {
      const match =
        url.match(REPO_NAME_SLASH_PATTERN) ??
        url.match(REPO_NAME_COLON_PATTERN);
      if (match) {
        return match[1].replace(".git", "");
      }
      return url.split("/").pop()?.replace(".git", "") ?? "unknown";
    };

    it("should extract name from GitHub SSH URL", () => {
      expect(extractRepoName("git@github.com:studio/backend.git")).toBe(
        "backend"
      );
    });

    it("should extract name from GitHub HTTPS URL", () => {
      expect(extractRepoName("https://github.com/studio/frontend.git")).toBe(
        "frontend"
      );
    });

    it("should extract name from URL without .git suffix", () => {
      expect(extractRepoName("https://github.com/studio/api")).toBe("api");
    });

    it("should handle GitLab URLs", () => {
      expect(extractRepoName("git@gitlab.com:org/project.git")).toBe("project");
    });
  });
});
