---
name: cin-cli
description: Manage airgapped deployments with CIN CLI - delivering Docker Compose applications to isolated environments
triggers:
  - cin
  - airgap
  - airgapped
  - offline deployment
  - закрытый контур
  - docker offline
  - delta transfer
  - package signing
  - rollback deployment
globs:
  - ".cin/**/*"
  - "**/cin.yaml"
  - "**/cin.config.yaml"
---

# CIN CLI Skill

Manage airgapped deployments with CIN CLI — a tool for delivering Docker Compose applications to isolated environments.

## When to Use

Use this skill when:
- User mentions "cin", "airgap", "offline deployment", "закрытый контур"
- Working with `.cin/` configuration directories
- Packaging Docker images for offline transfer
- Managing deploy keys, secrets, or rollbacks
- Creating delta packages for incremental updates

## CLI Commands Reference

### Initialization & Configuration

```bash
cin init                              # Initialize project (.cin/config.yaml)
cin init --global                     # Initialize global config (~/.cin/)
cin --config <path> <command>         # Use specific project directory
cin status                            # Show project status
```

### Repository Management

```bash
cin repo add <url> [--key <name>] [--branch <branch>]
cin repo list
cin repo remove <name>
```

### SSH Keys

```bash
cin key add <name> <path>             # Add SSH key to global config
cin key list
cin key remove <name>
cin key generate                      # Generate Ed25519 signing keys
```

### Core Workflow (Laboratory with Internet)

```bash
cin pull                              # Pull updates from all repos
cin pull --repo <name>                # Pull specific repo
cin build                             # Build Docker images
cin build --no-cache                  # Build without cache
cin pack                              # Create offline package
cin pack --sign                       # Create and sign package
cin pack --name <name> -o <dir>       # Custom output
```

### Delta Transfers (Incremental Updates)

```bash
cin delta <old.tar.gz> <new.tar.gz>   # Create delta (only changes)
cin patch <old.tar.gz> <delta.tar.gz> # Apply delta to old package
```

### Package Signing

```bash
cin key generate                      # Generate signing keypair
cin sign <package.tar.gz>             # Sign package
cin verify <package> --key <pub>      # Verify signature
```

### Deployment (Airgapped Environment)

```bash
cin verify <package.tar.gz>           # Verify checksums
cin deploy <package.tar.gz> -t /opt/app
cin deploy <package> --no-start       # Deploy without starting
cin rollback                          # Rollback to previous version
cin rollback --list                   # List available versions
cin rollback --to <version>           # Rollback to specific version
```

### Secrets Management

```bash
cin secrets setup                     # Interactive setup
cin secrets import <file>             # Import from .env or YAML
cin secrets list                      # Show configured secrets
cin secrets check                     # Verify all required secrets
cin secrets export --format env       # Export to .env format
```

### Logs & Diagnostics

```bash
cin logs                              # Live docker-compose logs
cin logs -f                           # Follow logs
cin logs collect                      # Collect logs for diagnostics
cin logs collect --days 3             # Last 3 days
```

### Tasks & Hooks

```bash
cin tasks list                        # List available tasks
cin run <task>                        # Run task
cin run <task> --sudo                 # Run with sudo
cin run <task> --dry-run              # Show what would run
cin run <task> --yes                  # Skip confirmation
```

## Configuration Files

### Project Config (`.cin/config.yaml`)

```yaml
version: 1
project:
  name: "my-product"
  type: "docker-compose"
vendor:
  name: "Studio Name"
  contact: "support@studio.com"
repositories:
  - name: backend
    url: "git@github.com:studio/backend.git"
    branch: main
    ssh_key: studio-main
  - name: frontend
    url: "git@github.com:studio/frontend.git"
    branch: main
    ssh_key: studio-main
```

### Hooks & Tasks (`.cin/hooks.yaml`)

```yaml
version: 1
hooks:
  pre-deploy:
    - name: "Backup database"
      run: "docker exec db pg_dump -U postgres > /backup/db.sql"
      timeout: 300
  post-deploy:
    - name: "Healthcheck"
      run: "curl -f http://localhost:3000/health"
      retries: 3
      retry_delay: 10

tasks:
  migrate:
    description: "Run database migrations"
    run: "docker exec api npm run migrate"
    confirm: true
  shell:
    description: "Open shell in API container"
    run: "docker exec -it api /bin/sh"
    interactive: true
```

## Typical Workflows

### Initial Setup (Laboratory)

```bash
cin init
cin repo add git@github.com:studio/backend.git --key studio
cin repo add git@github.com:studio/frontend.git --key studio
cin pull
cin build
cin pack --sign
# Transfer package to airgapped environment
```

### Update Deployment (Laboratory -> Airgapped)

```bash
# Laboratory
cin pull
cin build
cin delta releases/v1.0.tar.gz releases/v1.1.tar.gz
cin sign releases/v1.1-delta.tar.gz
# Transfer delta to airgapped

# Airgapped
cin patch /opt/packages/v1.0.tar.gz v1.1-delta.tar.gz
cin verify v1.1.tar.gz --key vendor.pub
cin deploy v1.1.tar.gz
```

### Troubleshooting (Airgapped)

```bash
cin logs collect
# Send cin-logs-*.tar.gz to vendor for analysis

cin rollback --list
cin rollback --to v1.0
```

## Directory Structure

```
project/
├── .cin/
│   ├── config.yaml       # Project configuration
│   ├── hooks.yaml        # Hooks and tasks
│   ├── repos/            # Cloned repositories
│   └── keys/             # Project-local SSH keys

~/.cin/
├── config.yaml           # Global configuration
├── signing-key.pem       # Private signing key
├── signing-key.pub       # Public signing key
└── secrets/              # Encrypted secrets

/opt/app/                 # Deployment target
├── current/              # Active deployment
├── versions/             # Rollback history
└── .cin/
    └── state.json        # Deployment state
```

## Best Practices

1. **Always sign packages** — use `cin pack --sign` or `cin sign`
2. **Use delta for updates** — saves bandwidth for large Docker images
3. **Test rollback** — verify `cin rollback` works before production
4. **Sanitize logs** — `cin logs collect` auto-removes secrets
5. **Store signing keys securely** — private key stays with package creator

## Installation

```bash
# Install from NPM
npm install -g @croissan/cin

# Or use npx
npx @croissan/cin init
```
