import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { readProjectConfig } from "./config.js";

const SECRETS_DIR = join(homedir(), ".cin", "secrets");
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 16;

// Regex patterns at top level for performance
const SPECIAL_CHARS_REGEX = /[\s"'$`\\]/;
const SECRET_NAME_REGEX = /^[A-Z_][A-Z0-9_]*$/i;

export interface SecretsStore {
  authTag: string;
  encrypted: string;
  iv: string;
  salt: string;
}

export interface SecretsData {
  [key: string]: string;
}

function getSecretsPath(projectName: string): string {
  return join(SECRETS_DIR, `${projectName}.enc.json`);
}

function getKeyfilePath(): string {
  return join(SECRETS_DIR, ".keyfile");
}

function ensureSecretsDir(): void {
  if (!existsSync(SECRETS_DIR)) {
    mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  }
}

function getOrCreateMasterKey(): string {
  ensureSecretsDir();
  const keyfilePath = getKeyfilePath();

  if (existsSync(keyfilePath)) {
    return readFileSync(keyfilePath, "utf-8").trim();
  }

  // Generate a random master key
  const masterKey = randomBytes(32).toString("hex");
  writeFileSync(keyfilePath, masterKey, { mode: 0o600 });
  return masterKey;
}

function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return scryptSync(masterKey, salt, KEY_LENGTH);
}

export function encryptSecrets(secrets: SecretsData): SecretsStore {
  const masterKey = getOrCreateMasterKey();
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(masterKey, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(secrets);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString("hex"),
    salt: salt.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

export function decryptSecrets(store: SecretsStore): SecretsData {
  const masterKey = getOrCreateMasterKey();
  const salt = Buffer.from(store.salt, "hex");
  const key = deriveKey(masterKey, salt);
  const iv = Buffer.from(store.iv, "hex");
  const authTag = Buffer.from(store.authTag, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(store.encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return JSON.parse(decrypted);
}

export function getProjectName(cwd = process.cwd()): string {
  const config = readProjectConfig(cwd);
  return config?.project?.name ?? "default";
}

export function saveSecrets(secrets: SecretsData, projectName?: string): void {
  ensureSecretsDir();
  const name = projectName ?? getProjectName();
  const store = encryptSecrets(secrets);
  const path = getSecretsPath(name);
  writeFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 });
}

export function loadSecrets(projectName?: string): SecretsData {
  const name = projectName ?? getProjectName();
  const path = getSecretsPath(name);

  if (!existsSync(path)) {
    return {};
  }

  const store: SecretsStore = JSON.parse(readFileSync(path, "utf-8"));
  return decryptSecrets(store);
}

export function secretsExist(projectName?: string): boolean {
  const name = projectName ?? getProjectName();
  return existsSync(getSecretsPath(name));
}

export function setSecret(
  key: string,
  value: string,
  projectName?: string
): void {
  const secrets = loadSecrets(projectName);
  secrets[key] = value;
  saveSecrets(secrets, projectName);
}

export function getSecret(
  key: string,
  projectName?: string
): string | undefined {
  const secrets = loadSecrets(projectName);
  return secrets[key];
}

export function deleteSecret(key: string, projectName?: string): boolean {
  const secrets = loadSecrets(projectName);
  if (!(key in secrets)) {
    return false;
  }
  delete secrets[key];
  saveSecrets(secrets, projectName);
  return true;
}

export function listSecretKeys(projectName?: string): string[] {
  const secrets = loadSecrets(projectName);
  return Object.keys(secrets);
}

function extractFromArrayEnv(env: unknown[], required: Set<string>): void {
  for (const item of env) {
    if (typeof item === "string" && !item.includes("=")) {
      required.add(item);
    }
  }
}

function extractFromObjectEnv(
  env: Record<string, unknown>,
  required: Set<string>
): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === null || value === undefined || value === "") {
      required.add(key);
    }
  }
}

/**
 * Parse docker-compose.yml to find required environment variables
 * (variables without default values)
 */
export function detectRequiredSecrets(composePath: string): string[] {
  if (!existsSync(composePath)) {
    return [];
  }

  const content = readFileSync(composePath, "utf-8");
  const compose = parseYaml(content);
  const required: Set<string> = new Set();

  if (!compose?.services) {
    return [];
  }

  for (const service of Object.values(compose.services) as Array<{
    environment?: unknown;
  }>) {
    if (!service.environment) {
      continue;
    }

    if (Array.isArray(service.environment)) {
      extractFromArrayEnv(service.environment, required);
    } else if (typeof service.environment === "object") {
      extractFromObjectEnv(
        service.environment as Record<string, unknown>,
        required
      );
    }
  }

  return Array.from(required).sort();
}

/**
 * Import secrets from .env file
 */
export function importFromEnv(envPath: string): SecretsData {
  const content = readFileSync(envPath, "utf-8");
  const secrets: SecretsData = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      secrets[key] = value;
    }
  }

  return secrets;
}

/**
 * Import secrets from YAML file
 */
export function importFromYaml(yamlPath: string): SecretsData {
  const content = readFileSync(yamlPath, "utf-8");
  const parsed = parseYaml(content);

  // Support both flat format and nested { secrets: {...} } format
  if (parsed?.secrets && typeof parsed.secrets === "object") {
    return parsed.secrets as SecretsData;
  }

  return parsed as SecretsData;
}

/**
 * Export secrets to .env format
 */
export function exportToEnv(secrets: SecretsData): string {
  const lines: string[] = [
    "# Generated by CIN CLI",
    "# DO NOT COMMIT THIS FILE",
    "",
  ];

  for (const [key, value] of Object.entries(secrets)) {
    // Quote values with special characters
    const needsQuotes = SPECIAL_CHARS_REGEX.test(value);
    const quotedValue = needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value;
    lines.push(`${key}=${quotedValue}`);
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Export secrets to YAML format
 */
export function exportToYaml(secrets: SecretsData): string {
  const lines: string[] = [
    "# Generated by CIN CLI",
    "# DO NOT COMMIT THIS FILE",
    "secrets:",
  ];

  for (const [key, value] of Object.entries(secrets)) {
    lines.push(`  ${key}: "${value.replace(/"/g, '\\"')}"`);
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Sanitize a value for display (mask sensitive data)
 */
export function maskValue(value: string): string {
  if (value.length <= 4) {
    return "****";
  }
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

export { SECRET_NAME_REGEX };

/**
 * Check which required secrets are missing
 */
export function checkMissingSecrets(
  requiredSecrets: string[],
  projectName?: string
): { configured: string[]; missing: string[] } {
  const secrets = loadSecrets(projectName);
  const configured: string[] = [];
  const missing: string[] = [];

  for (const key of requiredSecrets) {
    if (key in secrets && secrets[key]) {
      configured.push(key);
    } else {
      missing.push(key);
    }
  }

  return { configured, missing };
}

/**
 * Generate .env file content from secrets for deployment
 */
export function generateEnvFile(projectName?: string): string {
  const secrets = loadSecrets(projectName);
  return exportToEnv(secrets);
}
