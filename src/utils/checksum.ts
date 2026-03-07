import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function checksumFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(`sha256:${hash.digest("hex")}`));
    stream.on("error", reject);
  });
}

export function checksumString(str: string): string {
  const hash = createHash("sha256");
  hash.update(str);
  return `sha256:${hash.digest("hex")}`;
}
