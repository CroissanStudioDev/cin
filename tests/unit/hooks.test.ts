import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getHooks,
  getTask,
  getTasks,
  type HookDefinition,
  loadHooksConfig,
  runCommandSync,
  type TaskDefinition,
} from "../../src/lib/hooks.js";

describe("hooks", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cin-hooks-test-${Date.now()}`);
    mkdirSync(join(testDir, ".cin"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("loadHooksConfig", () => {
    it("should return empty config when no hooks.yaml exists", () => {
      const config = loadHooksConfig(testDir);

      expect(config.hooks).toEqual({});
      expect(config.tasks).toEqual({});
    });

    it("should load hooks config from file", () => {
      const hooksPath = join(testDir, ".cin", "hooks.yaml");
      writeFileSync(
        hooksPath,
        `
version: 1
hooks:
  pre-deploy:
    - name: backup
      run: echo "backup"
  post-deploy:
    - name: notify
      run: echo "deployed"
tasks:
  migrate:
    run: echo "migrate"
    description: Run database migrations
`
      );

      const config = loadHooksConfig(testDir);

      expect(config.version).toBe(1);
      expect(config.hooks?.["pre-deploy"]).toHaveLength(1);
      expect(config.hooks?.["post-deploy"]).toHaveLength(1);
      expect(config.tasks?.migrate).toBeDefined();
    });

    it("should return empty config on parse error", () => {
      const hooksPath = join(testDir, ".cin", "hooks.yaml");
      writeFileSync(hooksPath, "invalid: yaml: content: [");

      const config = loadHooksConfig(testDir);

      expect(config.hooks).toEqual({});
      expect(config.tasks).toEqual({});
    });
  });

  describe("getHooks", () => {
    it("should return hooks for specific type", () => {
      const hooksPath = join(testDir, ".cin", "hooks.yaml");
      writeFileSync(
        hooksPath,
        `
hooks:
  pre-deploy:
    - name: backup
      run: tar -czf backup.tar.gz ./data
    - name: notify-start
      run: curl -X POST https://hooks.example.com/start
  post-deploy:
    - name: cleanup
      run: rm -f backup.tar.gz
`
      );

      const preDeployHooks = getHooks("pre-deploy", testDir);
      const postDeployHooks = getHooks("post-deploy", testDir);
      const preRollbackHooks = getHooks("pre-rollback", testDir);

      expect(preDeployHooks).toHaveLength(2);
      expect(preDeployHooks[0].name).toBe("backup");
      expect(preDeployHooks[1].name).toBe("notify-start");
      expect(postDeployHooks).toHaveLength(1);
      expect(preRollbackHooks).toEqual([]);
    });

    it("should return empty array when no hooks defined", () => {
      const hooks = getHooks("pre-deploy", testDir);
      expect(hooks).toEqual([]);
    });
  });

  describe("getTasks", () => {
    it("should return all tasks", () => {
      const hooksPath = join(testDir, ".cin", "hooks.yaml");
      writeFileSync(
        hooksPath,
        `
tasks:
  migrate:
    run: npm run migrate
    description: Run database migrations
  seed:
    run: npm run seed
    description: Seed database
  backup:
    run: pg_dump > backup.sql
    sudo: true
`
      );

      const tasks = getTasks(testDir);

      expect(Object.keys(tasks)).toHaveLength(3);
      expect(tasks.migrate.description).toBe("Run database migrations");
      expect(tasks.backup.sudo).toBe(true);
    });

    it("should return empty object when no tasks defined", () => {
      const tasks = getTasks(testDir);
      expect(tasks).toEqual({});
    });
  });

  describe("getTask", () => {
    beforeEach(() => {
      const hooksPath = join(testDir, ".cin", "hooks.yaml");
      writeFileSync(
        hooksPath,
        `
tasks:
  migrate:
    run: npm run migrate
    description: Run database migrations
    timeout: 300
    retries: 2
`
      );
    });

    it("should return task by name", () => {
      const task = getTask("migrate", testDir);

      expect(task).not.toBeNull();
      expect(task?.run).toBe("npm run migrate");
      expect(task?.description).toBe("Run database migrations");
      expect(task?.timeout).toBe(300);
      expect(task?.retries).toBe(2);
    });

    it("should return null for non-existent task", () => {
      const task = getTask("nonexistent", testDir);
      expect(task).toBeNull();
    });
  });

  describe("runCommandSync", () => {
    it("should run simple command successfully", () => {
      const result = runCommandSync("echo hello");

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe("hello");
      expect(result.error).toBeUndefined();
    });

    it("should capture stdout", () => {
      const result = runCommandSync("echo 'line1' && echo 'line2'");

      expect(result.success).toBe(true);
      expect(result.output).toContain("line1");
      expect(result.output).toContain("line2");
    });

    it("should return failure for non-zero exit", () => {
      const result = runCommandSync("exit 1");

      expect(result.success).toBe(false);
    });

    it("should return failure for non-existent command", () => {
      const result = runCommandSync("nonexistent_command_xyz_123");

      expect(result.success).toBe(false);
    });

    it("should respect cwd option", () => {
      // Create a marker file in testDir and verify we can see it
      const markerFile = "test-marker-file.txt";
      writeFileSync(join(testDir, markerFile), "marker");

      // Use ls to check for the marker file instead of pwd
      // runCommandSync uses sh -c which runs in Git Bash on Windows
      const result = runCommandSync(`ls ${markerFile}`, { cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.output).toContain(markerFile);
    });

    it("should pass environment variables", () => {
      const result = runCommandSync("echo $TEST_VAR", {
        env: { TEST_VAR: "test_value" },
      });

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe("test_value");
    });

    it("should handle timeout", () => {
      const result = runCommandSync("sleep 10", { timeout: 100 });

      expect(result.success).toBe(false);
    });
  });

  describe("HookDefinition structure", () => {
    it("should support all hook properties", () => {
      const hook: HookDefinition = {
        name: "test-hook",
        run: "echo test",
        timeout: 60_000,
        retries: 3,
        retry_delay: 5000,
        continue_on_error: true,
      };

      expect(hook.name).toBe("test-hook");
      expect(hook.timeout).toBe(60_000);
      expect(hook.retries).toBe(3);
      expect(hook.continue_on_error).toBe(true);
    });
  });

  describe("TaskDefinition structure", () => {
    it("should support all task properties", () => {
      const task: TaskDefinition = {
        name: "test-task",
        run: "npm run test",
        description: "Run tests",
        timeout: 120,
        retries: 2,
        retry_delay: 10,
        sudo: false,
        confirm: true,
        interactive: true,
        env: { NODE_ENV: "test" },
      };

      expect(task.name).toBe("test-task");
      expect(task.sudo).toBe(false);
      expect(task.confirm).toBe(true);
      expect(task.interactive).toBe(true);
    });

    it("should support env as array", () => {
      const task: TaskDefinition = {
        run: "printenv",
        env: ["KEY1=value1", "KEY2=value2"],
      };

      expect(Array.isArray(task.env)).toBe(true);
    });
  });
});
