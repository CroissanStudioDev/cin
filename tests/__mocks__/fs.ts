// Mock fs module using memfs
// biome-ignore lint/performance/noBarrelFile: Required for test mocks
export {
  createReadStream,
  createWriteStream,
  existsSync,
  fs as default,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "memfs";
