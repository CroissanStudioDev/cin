import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * Calculate SHA256 checksum of a file
 */
export function checksumFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(`sha256:${hash.digest("hex")}`));
    stream.on("error", reject);
  });
}

/**
 * Calculate SHA256 checksum of a string
 */
export function checksumString(str) {
  const hash = createHash("sha256");
  hash.update(str);
  return `sha256:${hash.digest("hex")}`;
}
