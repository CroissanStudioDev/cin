import { loadSecrets } from "../lib/secrets.js";

// Regex for detecting sensitive variable names
const SENSITIVE_VAR_REGEX =
  /(?:password|secret|key|token|auth|credential|private)/i;

// Common patterns for sensitive data
const SENSITIVE_PATTERNS = [
  // API keys and tokens
  /(?:api[_-]?key|apikey|token|secret|password|passwd|pwd|auth)[=:]\s*["']?([^"'\s]+)/gi,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/gi,
  // Basic auth
  /Basic\s+[A-Za-z0-9+/=]+/gi,
  // Connection strings with passwords
  /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:([^@]+)@/gi,
  // AWS keys
  /(?:AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16}/g,
  // Private keys
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
];

// Mask a value preserving some characters for debugging
function maskValue(value: string): string {
  if (value.length <= 4) {
    return "****";
  }
  if (value.length <= 8) {
    return `${value[0]}****${value.at(-1)}`;
  }
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

/**
 * Sanitize text by removing known secrets and sensitive patterns
 */
export function sanitizeText(
  text: string,
  projectName?: string
): { sanitized: string; removedKeys: string[] } {
  let result = text;
  const removedKeys: Set<string> = new Set();

  // 1. Remove project secrets
  try {
    const secrets = loadSecrets(projectName);
    for (const [key, value] of Object.entries(secrets)) {
      if (value && value.length > 3) {
        // Escape special regex characters in value
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(escaped, "g");
        if (regex.test(result)) {
          result = result.replace(regex, maskValue(value));
          removedKeys.add(key);
        }
      }
    }
  } catch {
    // Secrets might not exist
  }

  // 2. Apply generic sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;

    if (pattern.test(result)) {
      pattern.lastIndex = 0;
      result = result.replace(pattern, (match) => {
        removedKeys.add("PATTERN_MATCH");
        return maskValue(match);
      });
    }
  }

  return { sanitized: result, removedKeys: Array.from(removedKeys) };
}

/**
 * Sanitize environment file content
 * Preserves keys but masks values
 */
export function sanitizeEnvFile(content: string): string {
  const lines: string[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Keep comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) {
      lines.push(line);
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      lines.push(line);
      continue;
    }

    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);

    // Check if this looks like a sensitive variable
    const isSensitive = SENSITIVE_VAR_REGEX.test(key) || value.length > 20;

    if (isSensitive && value) {
      lines.push(`${key}=${maskValue(value)}`);
    } else {
      lines.push(line);
    }
  }

  return lines.join("\n");
}
