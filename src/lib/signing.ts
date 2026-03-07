import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const ALGORITHM = "Ed25519";
const SIGNATURE_FILE_EXT = ".sig";

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

export interface SignatureInfo {
  algorithm: string;
  keyId: string;
  signature: string;
  signedAt: string;
}

/**
 * Generate Ed25519 key pair for signing packages
 */
export function generateSigningKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
  });

  return { privateKey, publicKey };
}

/**
 * Get default signing key paths
 */
export function getSigningKeyPaths(cwd?: string): {
  privateKeyPath: string;
  publicKeyPath: string;
} {
  const baseDir = cwd ? join(cwd, ".cin") : join(homedir(), ".cin");
  return {
    privateKeyPath: join(baseDir, "signing-key.pem"),
    publicKeyPath: join(baseDir, "signing-key.pub"),
  };
}

/**
 * Save key pair to files
 */
export function saveKeyPair(
  keyPair: KeyPair,
  privateKeyPath: string,
  publicKeyPath: string
): void {
  mkdirSync(dirname(privateKeyPath), { recursive: true });
  mkdirSync(dirname(publicKeyPath), { recursive: true });

  writeFileSync(privateKeyPath, keyPair.privateKey, { mode: 0o600 });
  writeFileSync(publicKeyPath, keyPair.publicKey, { mode: 0o644 });
}

/**
 * Load private key from file
 */
export function loadPrivateKey(keyPath: string): string {
  if (!existsSync(keyPath)) {
    throw new Error(`Private key not found: ${keyPath}`);
  }
  return readFileSync(keyPath, "utf-8");
}

/**
 * Load public key from file
 */
export function loadPublicKey(keyPath: string): string {
  if (!existsSync(keyPath)) {
    throw new Error(`Public key not found: ${keyPath}`);
  }
  return readFileSync(keyPath, "utf-8");
}

/**
 * Generate key ID from public key (first 16 chars of hex hash)
 */
export function getKeyId(publicKey: string): string {
  return createHash("sha256").update(publicKey).digest("hex").slice(0, 16);
}

/**
 * Sign data with private key
 */
export function signData(data: Buffer, privateKeyPem: string): string {
  const privateKey = createPrivateKey(privateKeyPem);
  const signature = sign(null, data, privateKey);
  return signature.toString("base64");
}

/**
 * Verify signature with public key
 */
export function verifySignature(
  data: Buffer,
  signature: string,
  publicKeyPem: string
): boolean {
  try {
    const publicKey = createPublicKey(publicKeyPem);
    const signatureBuffer = Buffer.from(signature, "base64");
    return verify(null, data, publicKey, signatureBuffer);
  } catch {
    return false;
  }
}

/**
 * Sign a package file
 */
export function signPackage(
  packagePath: string,
  privateKeyPath: string
): SignatureInfo {
  if (!existsSync(packagePath)) {
    throw new Error(`Package not found: ${packagePath}`);
  }

  const privateKey = loadPrivateKey(privateKeyPath);
  const publicKey = derivePublicKey(privateKey);
  const packageData = readFileSync(packagePath);
  const signature = signData(packageData, privateKey);

  const signatureInfo: SignatureInfo = {
    algorithm: ALGORITHM,
    keyId: getKeyId(publicKey),
    signature,
    signedAt: new Date().toISOString(),
  };

  // Save signature to .sig file
  const sigPath = packagePath + SIGNATURE_FILE_EXT;
  writeFileSync(sigPath, JSON.stringify(signatureInfo, null, 2));

  return signatureInfo;
}

/**
 * Derive public key from private key
 */
export function derivePublicKey(privateKeyPem: string): string {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey);
  return publicKey.export({ type: "spki", format: "pem" }) as string;
}

/**
 * Verify a signed package
 */
export function verifyPackage(
  packagePath: string,
  publicKeyPath: string
): { valid: boolean; error?: string; signatureInfo?: SignatureInfo } {
  const sigPath = packagePath + SIGNATURE_FILE_EXT;

  if (!existsSync(packagePath)) {
    return { valid: false, error: `Package not found: ${packagePath}` };
  }

  if (!existsSync(sigPath)) {
    return { valid: false, error: "No signature file found (.sig)" };
  }

  try {
    const signatureInfo: SignatureInfo = JSON.parse(
      readFileSync(sigPath, "utf-8")
    );
    const publicKey = loadPublicKey(publicKeyPath);
    const packageData = readFileSync(packagePath);

    // Verify key ID matches
    const expectedKeyId = getKeyId(publicKey);
    if (signatureInfo.keyId !== expectedKeyId) {
      return {
        valid: false,
        error: `Key ID mismatch: expected ${expectedKeyId}, got ${signatureInfo.keyId}`,
        signatureInfo,
      };
    }

    const isValid = verifySignature(
      packageData,
      signatureInfo.signature,
      publicKey
    );

    if (!isValid) {
      return {
        valid: false,
        error: "Signature verification failed",
        signatureInfo,
      };
    }

    return { valid: true, signatureInfo };
  } catch (err) {
    return {
      valid: false,
      error: `Verification error: ${(err as Error).message}`,
    };
  }
}

/**
 * Check if signing keys exist
 */
export function signingKeysExist(cwd?: string): boolean {
  const { privateKeyPath, publicKeyPath } = getSigningKeyPaths(cwd);
  return existsSync(privateKeyPath) && existsSync(publicKeyPath);
}

/**
 * Get signature file path for a package
 */
export function getSignatureFilePath(packagePath: string): string {
  return packagePath + SIGNATURE_FILE_EXT;
}
