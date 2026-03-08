import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI_PATH = join(process.cwd(), "dist/bin/cin.js");

// Top-level regex constants
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

interface ExecResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

function runCli(args: string[], cwd?: string): ExecResult {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args.join(" ")}`, {
      encoding: "utf-8",
      cwd,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.status ?? 1,
    };
  }
}

describe("CLI Integration Tests", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cin-cli-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("--version", () => {
    it("should display version number", () => {
      const result = runCli(["--version"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(VERSION_PATTERN);
    });
  });

  describe("--help", () => {
    it("should display help text", () => {
      const result = runCli(["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("CLI for delivering code to airgapped");
      expect(result.stdout).toContain("Commands:");
    });

    it("should list all main commands", () => {
      const result = runCli(["--help"]);
      const expectedCommands = [
        "init",
        "repo",
        "key",
        "secrets",
        "pull",
        "build",
        "pack",
        "delta",
        "patch",
        "sign",
        "deploy",
        "verify",
        "rollback",
        "logs",
        "tasks",
        "run",
        "status",
      ];

      for (const cmd of expectedCommands) {
        expect(result.stdout).toContain(cmd);
      }
    });
  });

  describe("init", () => {
    it("should initialize project with --yes flag", () => {
      const result = runCli(["init", "--yes"], testDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Created project config");

      const configPath = join(testDir, ".cin", "config.yaml");
      expect(existsSync(configPath)).toBe(true);

      const config = readFileSync(configPath, "utf-8");
      expect(config).toContain("version: 1");
      expect(config).toContain("project:");
    });

    it("should create keys directory", () => {
      runCli(["init", "--yes"], testDir);
      const keysDir = join(testDir, ".cin", "keys");
      expect(existsSync(keysDir)).toBe(true);
    });
  });

  describe("status", () => {
    it("should show status for initialized project", () => {
      runCli(["init", "--yes"], testDir);
      const result = runCli(["status"], testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("CIN Status");
      expect(result.stdout).toContain("Project Config:");
    });

    it("should show not initialized for empty directory", () => {
      const result = runCli(["status"], testDir);
      expect(result.stdout).toContain("Not initialized");
    });
  });

  describe("repo", () => {
    beforeEach(() => {
      runCli(["init", "--yes"], testDir);
    });

    it("should list empty repositories", () => {
      const result = runCli(["repo", "list"], testDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No repositories configured");
    });

    it("should add repository", () => {
      const result = runCli(
        ["repo", "add", "https://github.com/test/repo.git"],
        testDir
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Added repository");
    });

    it("should list added repository", () => {
      runCli(["repo", "add", "https://github.com/test/repo.git"], testDir);
      const result = runCli(["repo", "list"], testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("repo");
    });

    it("should remove repository", () => {
      runCli(["repo", "add", "https://github.com/test/repo.git"], testDir);
      const result = runCli(["repo", "remove", "repo"], testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Removed repository");
    });
  });

  describe("key", () => {
    it("should list keys", () => {
      const result = runCli(["key", "list"]);
      expect(result.exitCode).toBe(0);
    });

    it("should generate signing keys", () => {
      const result = runCli(["key", "generate"]);
      // May succeed (0), say keys already exist (13 VALIDATION_ERROR), or other error
      expect([0, 13]).toContain(result.exitCode);
    });
  });

  describe("--config option", () => {
    it("should use custom config path", () => {
      runCli(["init", "--yes"], testDir);
      const result = runCli(["--config", testDir, "status"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(testDir);
    });
  });

  describe("Error handling", () => {
    it("should return FILE_ERROR (14) for missing package", () => {
      const result = runCli(["verify", "/nonexistent/package.tar.gz"]);
      expect(result.exitCode).toBe(14);
      expect(result.stderr + result.stdout).toContain("not found");
    });

    it("should return CONFIG_ERROR (10) for missing project", () => {
      const result = runCli(["pull"], testDir);
      expect(result.exitCode).toBe(10);
      expect(result.stderr + result.stdout).toContain("not initialized");
    });

    it("should return error for missing required argument", () => {
      const result = runCli(["deploy"]);
      expect(result.exitCode).toBeGreaterThan(0);
      expect(result.stderr).toContain("missing required argument");
    });

    it("should return error for unknown command", () => {
      const result = runCli(["unknowncommand"]);
      expect(result.exitCode).toBeGreaterThan(0);
    });
  });
});

describe("CLI Subcommand Help", () => {
  const subcommands = [
    "init",
    "repo",
    "key",
    "secrets",
    "pull",
    "build",
    "pack",
    "sign",
    "deploy",
    "verify",
    "rollback",
    "logs",
    "tasks",
    "run",
    "status",
  ];

  for (const cmd of subcommands) {
    it(`should display help for ${cmd}`, () => {
      const result = runCli([cmd, "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Usage:");
    });
  }
});
