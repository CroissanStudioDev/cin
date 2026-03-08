# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CIN CLI — инструмент для доставки кода в airgapped (закрытые) контуры. Заказчики используют его для получения кода от студий-разработчиков, сборки Docker images и развёртывания в изолированных сетях без интернета.

**Ключевой сценарий:** Лаборатория (с интернетом) → USB/NAS → Закрытый контур (без интернета)

## Commands

```bash
# Development
pnpm install                   # Install dependencies
pnpm dev                       # Run CLI: tsx bin/cin.ts
pnpm link --global             # Link globally for local testing

# Linting & Formatting (Ultracite + Biome)
pnpm check                     # Check for issues
pnpm fix                       # Auto-fix issues

# CLI commands (via cin or node bin/cin.js)
cin init                       # Initialize project config
cin repo add <url>             # Add repository
cin repo list                  # List repositories
cin key add <name> <path>      # Add SSH key
cin pull                       # Pull updates from repos
cin status                     # Show project status
```

## Code Style (Ultracite)

This project uses **Ultracite** with **Biome** for linting and formatting. Pre-commit hook auto-fixes code via Lefthook.

Key rules:
- Move regex literals to top-level constants (performance)
- Extract functions to reduce cognitive complexity (max 20)
- Remove unused variables (or prefix with `_`)
- Use `const` by default, `let` only when needed
- Arrow functions for callbacks, `for...of` over `.forEach()`
- `async/await` over promise chains

## Architecture

```
bin/cin.js            # Entry point
src/
├── commands/         # CLI commands (Commander.js handlers)
│   ├── init.js       # cin init
│   ├── pull.js       # cin pull (git operations)
│   ├── status.js     # cin status
│   ├── repo/         # cin repo add/list/remove
│   └── key/          # cin key add/list/remove
├── lib/
│   └── config.js     # YAML config management (.cin/config.yaml)
└── utils/
    └── logger.js     # Formatted output (ora, chalk)
```

### Planned (v0.2.0+)

- `build.js`, `pack.js` — docker-compose build, create offline packages
- `deploy.js`, `rollback.js` — deployment and version management
- `secrets/`, `logs/`, `tasks/` — secrets, logs, hooks

## Key Design Principles

### Idempotency
All commands must be safe to run multiple times:
- `pull` → `[SKIP] already at commit abc1234`
- `deploy` → `[SKIP] Already deployed: v1.2.3`
- Output status: `[SKIP]`, `[UPDATE]`, `[NEW]`

### Security
- SSH keys stored in `~/.cin/`, never in packages
- Secrets encrypted with AES-256, stored in `~/.cin/secrets/`
- `sanitizer.js` removes secrets from logs before sharing
- Checksums (SHA256) for all files in manifest.json

### Offline-First
- `pack` creates self-contained archive with Docker images
- `deploy` works without internet (docker load from tar)
- Git bundles instead of clone for source transfer

## Configuration Files

```
~/.cin/config.yaml           # Global config (SSH keys, defaults)
.cin/config.yaml             # Project config (repos, docker settings)
.cin/hooks.yaml              # Lifecycle hooks & tasks
~/.cin/secrets/<project>.enc # Encrypted secrets
```

## Tech Stack

| Component | Library | Notes |
|-----------|---------|-------|
| CLI Framework | Commander.js | Subcommands, options, help |
| Config | yaml | YAML parsing |
| Git | simple-git | Clone, pull, bundle |
| Progress | ora | Spinners |
| Colors | chalk | Terminal colors |
| Prompts | inquirer | Interactive input |
| Archive | tar, archiver | Package creation |

## Dependencies

- Node.js 20 LTS+
- Git 2.30+ (лаборатория)
- Docker 20.10+
- Docker Compose v2.0+
