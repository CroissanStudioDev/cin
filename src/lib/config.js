import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";

const GLOBAL_CONFIG_DIR = join(homedir(), ".cin");
const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, "config.yaml");
const PROJECT_CONFIG_DIR = ".cin";
const PROJECT_CONFIG_FILE = join(PROJECT_CONFIG_DIR, "config.yaml");

const DEFAULT_GLOBAL_CONFIG = {
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

const DEFAULT_PROJECT_CONFIG = {
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

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readYaml(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  const content = readFileSync(filePath, "utf-8");
  return parse(content);
}

function writeYaml(filePath, data) {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, stringify(data), "utf-8");
}

export function getGlobalConfigPath() {
  return GLOBAL_CONFIG_FILE;
}

export function getProjectConfigPath(cwd = process.cwd()) {
  return join(cwd, PROJECT_CONFIG_FILE);
}

export function globalConfigExists() {
  return existsSync(GLOBAL_CONFIG_FILE);
}

export function projectConfigExists(cwd = process.cwd()) {
  return existsSync(getProjectConfigPath(cwd));
}

export function readGlobalConfig() {
  return readYaml(GLOBAL_CONFIG_FILE) || { ...DEFAULT_GLOBAL_CONFIG };
}

export function readProjectConfig(cwd = process.cwd()) {
  return readYaml(getProjectConfigPath(cwd));
}

export function writeGlobalConfig(config) {
  writeYaml(GLOBAL_CONFIG_FILE, config);
}

export function writeProjectConfig(config, cwd = process.cwd()) {
  writeYaml(getProjectConfigPath(cwd), config);
}

export function initGlobalConfig(overrides = {}) {
  const config = { ...DEFAULT_GLOBAL_CONFIG, ...overrides };
  writeGlobalConfig(config);
  return config;
}

export function initProjectConfig(overrides = {}, cwd = process.cwd()) {
  const config = { ...DEFAULT_PROJECT_CONFIG, ...overrides };
  writeProjectConfig(config, cwd);
  return config;
}

export function addRepository(repo, cwd = process.cwd()) {
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

export function removeRepository(name, cwd = process.cwd()) {
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

export function getRepositories(cwd = process.cwd()) {
  const config = readProjectConfig(cwd);
  return config?.repositories || [];
}

export function addSshKey(name, path) {
  const config = readGlobalConfig();
  config.ssh_keys[name] = path;
  writeGlobalConfig(config);
  return config;
}

export function removeSshKey(name) {
  const config = readGlobalConfig();
  if (!config.ssh_keys[name]) {
    throw new Error(`SSH key '${name}' not found.`);
  }
  delete config.ssh_keys[name];
  writeGlobalConfig(config);
  return config;
}

export function getSshKeys() {
  const config = readGlobalConfig();
  return config.ssh_keys || {};
}

export function resolveSshKey(keyNameOrPath) {
  if (existsSync(keyNameOrPath)) {
    return keyNameOrPath;
  }
  const keys = getSshKeys();
  if (keys[keyNameOrPath]) {
    return keys[keyNameOrPath].replace("~", homedir());
  }
  return null;
}
