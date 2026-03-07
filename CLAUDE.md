# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CIN CLI — инструмент для доставки кода в airgapped (закрытые) контуры. Заказчики используют его для получения кода от студий-разработчиков, сборки Docker images и развёртывания в изолированных сетях без интернета.

**Ключевой сценарий:** Лаборатория (с интернетом) → USB/NAS → Закрытый контур (без интернета)

## Commands

```bash
# Development
npm install                    # Install dependencies
npm run dev                    # Run in development mode
npm link                       # Link globally for local testing

# Linting & Formatting (Ultracite + Biome)
npm run check                  # Check for issues
npm run fix                    # Auto-fix issues
npx ultracite doctor           # Diagnose setup

# Testing
npm test                       # Run all tests
npm test -- --watch           # Watch mode
npm test -- path/to/test.js   # Single test file

# Build & Release
npm run build                  # Build for production
```

## Code Style (Ultracite)

This project uses **Ultracite** with **Biome** for linting and formatting. Pre-commit hook auto-fixes code via Lefthook.

Key rules:
- Use `const` by default, `let` only when needed, never `var`
- Arrow functions for callbacks
- `for...of` over `.forEach()`
- Optional chaining (`?.`) and nullish coalescing (`??`)
- Template literals over concatenation
- Explicit types for function params/returns
- `async/await` over promise chains
- Remove `console.log` and `debugger` before commit

## Architecture

```
src/
├── commands/          # CLI commands (Commander.js handlers)
│   ├── init.js       # cin init
│   ├── pull.js       # cin pull (git operations)
│   ├── build.js      # cin build (docker-compose build)
│   ├── pack.js       # cin pack (create offline package)
│   ├── deploy.js     # cin deploy (extract + docker load + up)
│   ├── rollback.js   # cin rollback (restore previous version)
│   ├── repo/         # cin repo add/list/remove
│   ├── key/          # cin key add/list/remove
│   ├── secrets/      # cin secrets setup/import/list/check
│   ├── logs/         # cin logs / cin logs collect
│   └── tasks/        # cin tasks list / cin run <task>
├── lib/              # Core business logic
│   ├── config.js     # YAML config management (.cin/config.yaml)
│   ├── git.js        # Git operations via simple-git
│   ├── docker.js     # Docker/docker-compose operations
│   ├── packager.js   # Create offline packages (tar + docker save)
│   ├── deployer.js   # Deploy packages (docker load + compose up)
│   ├── rollback.js   # Version management & rollback
│   ├── secrets.js    # Encrypted secrets management (AES-256)
│   ├── hooks.js      # Lifecycle hooks (pre/post-deploy)
│   ├── tasks.js      # Configurable tasks execution
│   ├── logs.js       # Log collection for diagnostics
│   └── manifest.js   # manifest.json generation
└── utils/
    ├── checksum.js   # SHA256 verification
    ├── crypto.js     # Secrets encryption
    ├── sanitizer.js  # Remove secrets from logs
    ├── logger.js     # Formatted output (ora, chalk)
    └── prompts.js    # Interactive prompts (inquirer)
```

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
