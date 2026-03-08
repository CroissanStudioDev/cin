import { describe, expect, it } from "vitest";
import { sanitizeEnvFile, sanitizeText } from "../../src/utils/sanitizer.js";

describe("sanitizer", () => {
  describe("sanitizeText", () => {
    it("should mask API keys in text", () => {
      const text = "api_key=sk_live_1234567890abcdef";
      const { sanitized } = sanitizeText(text);
      expect(sanitized).not.toContain("sk_live_1234567890abcdef");
      expect(sanitized).toContain("****");
    });

    it("should mask bearer tokens", () => {
      const text =
        "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const { sanitized } = sanitizeText(text);
      expect(sanitized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    });

    it("should mask basic auth", () => {
      const text = "Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQ=";
      const { sanitized } = sanitizeText(text);
      expect(sanitized).not.toContain("dXNlcm5hbWU6cGFzc3dvcmQ=");
    });

    it("should mask connection strings", () => {
      const text = "postgres://user:supersecretpassword@localhost:5432/db";
      const { sanitized } = sanitizeText(text);
      expect(sanitized).not.toContain("supersecretpassword");
    });

    it("should mask AWS keys", () => {
      const text = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
      const { sanitized } = sanitizeText(text);
      expect(sanitized).not.toContain("AKIAIOSFODNN7EXAMPLE");
    });

    it("should mask private keys", () => {
      const text = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC1
-----END PRIVATE KEY-----`;
      const { sanitized } = sanitizeText(text);
      expect(sanitized).not.toContain(
        "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC1"
      );
    });

    it("should track removed keys", () => {
      const text = "secret=mysecret123";
      const { removedKeys } = sanitizeText(text);
      expect(removedKeys.length).toBeGreaterThan(0);
    });

    it("should preserve non-sensitive text", () => {
      const text = "This is a normal log message with no secrets";
      const { sanitized } = sanitizeText(text);
      expect(sanitized).toBe(text);
    });

    it("should handle empty string", () => {
      const { sanitized } = sanitizeText("");
      expect(sanitized).toBe("");
    });

    it("should handle multiline text", () => {
      const text = `Line 1: normal
Line 2: password=secret123
Line 3: normal again`;
      const { sanitized } = sanitizeText(text);
      expect(sanitized).toContain("Line 1: normal");
      expect(sanitized).not.toContain("secret123");
      expect(sanitized).toContain("Line 3: normal again");
    });
  });

  describe("sanitizeEnvFile", () => {
    it("should mask sensitive variable values", () => {
      const content = `DB_PASSWORD=supersecretpass
API_KEY=sk_live_123456`;
      const sanitized = sanitizeEnvFile(content);

      expect(sanitized).not.toContain("supersecretpass");
      expect(sanitized).not.toContain("sk_live_123456");
      expect(sanitized).toContain("DB_PASSWORD=");
      expect(sanitized).toContain("API_KEY=");
    });

    it("should preserve comments", () => {
      const content = `# This is a comment
PASSWORD=secret`;
      const sanitized = sanitizeEnvFile(content);

      expect(sanitized).toContain("# This is a comment");
    });

    it("should preserve empty lines", () => {
      const content = `VAR1=value1

VAR2=value2`;
      const sanitized = sanitizeEnvFile(content);

      expect(sanitized.split("\n")).toHaveLength(3);
    });

    it("should preserve non-sensitive variables", () => {
      const content = `PORT=3000
HOST=localhost
DEBUG=true`;
      const sanitized = sanitizeEnvFile(content);

      expect(sanitized).toContain("PORT=3000");
      expect(sanitized).toContain("HOST=localhost");
      expect(sanitized).toContain("DEBUG=true");
    });

    it("should mask long values even without sensitive name", () => {
      const content = "SOME_VAR=thisisaverylongvaluethatmightbeasecret";
      const sanitized = sanitizeEnvFile(content);

      expect(sanitized).not.toContain("thisisaverylongvaluethatmightbeasecret");
      expect(sanitized).toContain("****");
    });

    it("should handle lines without equals sign", () => {
      const content = `export PATH
PASSWORD=secret`;
      const sanitized = sanitizeEnvFile(content);

      expect(sanitized).toContain("export PATH");
    });

    it("should handle empty values", () => {
      const content = `EMPTY_VAR=
PASSWORD=secret`;
      const sanitized = sanitizeEnvFile(content);

      expect(sanitized).toContain("EMPTY_VAR=");
    });

    it("should handle empty file", () => {
      const sanitized = sanitizeEnvFile("");
      expect(sanitized).toBe("");
    });

    it("should detect sensitive keywords in variable names", () => {
      const sensitiveNames = [
        "PASSWORD",
        "SECRET",
        "API_KEY",
        "AUTH_TOKEN",
        "PRIVATE_KEY",
        "CREDENTIAL",
      ];

      for (const name of sensitiveNames) {
        const content = `${name}=value123`;
        const sanitized = sanitizeEnvFile(content);
        expect(sanitized).not.toContain("value123");
        expect(sanitized).toContain(`${name}=`);
      }
    });
  });
});
