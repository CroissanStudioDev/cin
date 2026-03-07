import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";

const GLOBAL_CONFIG_DIR = join(homedir(), ".cin");
const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, "config.yaml");
const PROJECT_CONFIG_DIR = ".cin";
const PROJECT_CONFIG_FILE = join(PROJECT_CONFIG_DIR, "config.yaml");

export interface SshKeys {
  [name: string]: string;
}

export interface GlobalConfig {
  defaults: {
    pack_format: string;
    output_dir: string;
    branch: string;
  };
  organization: {
    name: string;
  };
  ssh_keys: SshKeys;
  version: number;
}

export interface Repository {
  branch?: string;
  name: string;
  ssh_key?: string;
  submodules?: SubmoduleConfig[];
  url: string;
}

export interface SubmoduleConfig {
  path: string;
  ssh_key?: string;
}

export interface ProjectConfig {
  build?: {
    compose_file?: string;
    build_args?: Record<string, string>;
  };
  project: {
    name: string;
    type: string;
  };
  repositories: Repository[];
  vendor: {
    name: string;
    contact: string;
  };
  version: number;
}

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  version: 1,
  organization: {
    name: "",
  },
  ssh_keys: {},
  defaults: {
    pack_format: "tar.gz",
    output_dir: "./releases",
    branch: "main",
  },
};

const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  version: 1,
  project: {
    name: "",
    type: "docker-compose",
  },
  vendor: {
    name: "",
    contact: "",
  },
  repositories: [],
};

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readYaml<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }
  const content = readFileSync(filePath, "utf-8");
  return parse(content) as T;
}

function writeYaml(filePath: string, data: unknown): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, stringify(data), "utf-8");
}

export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG_FILE;
}

export function getProjectConfigPath(cwd = process.cwd()): string {
  return join(cwd, PROJECT_CONFIG_FILE);
}

export function globalConfigExists(): boolean {
  return existsSync(GLOBAL_CONFIG_FILE);
}

export function projectConfigExists(cwd = process.cwd()): boolean {
  return existsSync(getProjectConfigPath(cwd));
}

export function readGlobalConfig(): GlobalConfig {
  return (
    readYaml<GlobalConfig>(GLOBAL_CONFIG_FILE) ?? { ...DEFAULT_GLOBAL_CONFIG }
  );
}

export function readProjectConfig(cwd = process.cwd()): ProjectConfig | null {
  return readYaml<ProjectConfig>(getProjectConfigPath(cwd));
}

export function writeGlobalConfig(config: GlobalConfig): void {
  writeYaml(GLOBAL_CONFIG_FILE, config);
}

export function writeProjectConfig(
  config: ProjectConfig,
  cwd = process.cwd()
): void {
  writeYaml(getProjectConfigPath(cwd), config);
}

export function initGlobalConfig(
  overrides: Partial<GlobalConfig> = {}
): GlobalConfig {
  const config = { ...DEFAULT_GLOBAL_CONFIG, ...overrides };
  writeGlobalConfig(config);
  return config;
}

export function initProjectConfig(
  overrides: Partial<ProjectConfig> = {},
  cwd = process.cwd()
): ProjectConfig {
  const config = { ...DEFAULT_PROJECT_CONFIG, ...overrides };
  writeProjectConfig(config, cwd);
  return config;
}

export function addRepository(
  repo: Repository,
  cwd = process.cwd()
): ProjectConfig {
  const config = readProjectConfig(cwd);
  if (!config) {
    throw new Error("Project not initialized. Run 'cin init' first.");
  }

  const existing = config.repositories.find((r) => r.name === repo.name);
  if (existing) {
    throw new Error(`Repository '${repo.name}' already exists.`);
  }

  config.repositories.push(repo);
  writeProjectConfig(config, cwd);
  return config;
}

export function removeRepository(
  name: string,
  cwd = process.cwd()
): ProjectConfig {
  const config = readProjectConfig(cwd);
  if (!config) {
    throw new Error("Project not initialized. Run 'cin init' first.");
  }

  const index = config.repositories.findIndex((r) => r.name === name);
  if (index === -1) {
    throw new Error(`Repository '${name}' not found.`);
  }

  config.repositories.splice(index, 1);
  writeProjectConfig(config, cwd);
  return config;
}

export function getRepositories(cwd = process.cwd()): Repository[] {
  const config = readProjectConfig(cwd);
  return config?.repositories ?? [];
}

export function addSshKey(name: string, path: string): GlobalConfig {
  const config = readGlobalConfig();
  config.ssh_keys[name] = path;
  writeGlobalConfig(config);
  return config;
}

export function removeSshKey(name: string): GlobalConfig {
  const config = readGlobalConfig();
  if (!config.ssh_keys[name]) {
    throw new Error(`SSH key '${name}' not found.`);
  }
  delete config.ssh_keys[name];
  writeGlobalConfig(config);
  return config;
}

export function getSshKeys(): SshKeys {
  const config = readGlobalConfig();
  return config.ssh_keys ?? {};
}

export function resolveSshKey(keyNameOrPath: string): string | null {
  if (existsSync(keyNameOrPath)) {
    return keyNameOrPath;
  }
  const keys = getSshKeys();
  if (keys[keyNameOrPath]) {
    return keys[keyNameOrPath].replace("~", homedir());
  }
  return null;
}
