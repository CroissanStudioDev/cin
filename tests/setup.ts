import { vol } from "memfs";
import { beforeEach, vi } from "vitest";

// Reset virtual file system before each test
beforeEach(() => {
  vol.reset();
});

// Mock process.exit to prevent tests from exiting
vi.spyOn(process, "exit").mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});
