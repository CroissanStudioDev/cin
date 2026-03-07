import { basename } from "node:path";
import { Command } from "commander";
import {
  addRepository,
  projectConfigExists,
  resolveSshKey,
} from "../../lib/config.js";
import { formatRepo, logger } from "../../utils/logger.js";

// Regex patterns for extracting repo name from URL (moved to top level for performance)
const REPO_NAME_SLASH_PATTERN = /\/([^/]+?)(?:\.git)?$/;
const REPO_NAME_COLON_PATTERN = /:([^/]+?)(?:\.git)?$/;

export const addCommand = new Command("add")
  .description("Add a repository")
  .argument("<url>", "Repository URL (git@github.com:...)")
  .option("-n, --name <name>", "Repository name (default: derived from URL)")
  .option("-k, --key <key>", "SSH key name or path")
  .option("-b, --branch <branch>", "Branch to track", "main")
  .option("-c, --compose <file>", "Docker compose file", "docker-compose.yml")
  .option("--submodules", "Enable submodules support (default: true)", true)
  .option("--no-submodules", "Disable submodules support")
  .option(
    "--submodules-keys <json>",
    'SSH keys for submodules: \'{"path":"key-name"}\''
  )
  .action((url, options) => {
    if (!projectConfigExists()) {
      logger.error("Project not initialized. Run 'cin init' first.");
      process.exit(1);
    }

    const name = options.name || extractRepoName(url);

    if (options.key) {
      const resolvedKey = resolveSshKey(options.key);
      if (!resolvedKey) {
        logger.error(
          `SSH key '${options.key}' not found. Add it with 'cin key add'.`
        );
        process.exit(1);
      }
    }

    // Parse submodules keys if provided
    let submodulesKeys = {};
    if (options.submodulesKeys) {
      try {
        submodulesKeys = JSON.parse(options.submodulesKeys);
      } catch {
        logger.error("Invalid JSON for --submodules-keys");
        process.exit(1);
      }
    }

    const repo = {
      name,
      url,
      branch: options.branch,
      ssh_key: options.key || null,
      submodules: {
        enabled: options.submodules,
        recursive: true,
        keys: submodulesKeys,
      },
      docker: {
        compose_file: options.compose,
        services: [],
        build_args: {},
      },
    };

    try {
      addRepository(repo);
      logger.success(`Added repository ${formatRepo(name)}`);
      logger.info(`  URL: ${url}`);
      logger.info(`  Branch: ${options.branch}`);
      logger.info(`  Compose: ${options.compose}`);
      logger.info(
        `  Submodules: ${options.submodules ? "enabled" : "disabled"}`
      );
    } catch (error) {
      logger.error(error.message);
      process.exit(1);
    }
  });

function extractRepoName(url) {
  // git@github.com:studio/backend.git -> backend
  // https://github.com/studio/backend.git -> backend
  const match =
    url.match(REPO_NAME_SLASH_PATTERN) || url.match(REPO_NAME_COLON_PATTERN);
  if (match) {
    return match[1].replace(".git", "");
  }
  return basename(url, ".git");
}
