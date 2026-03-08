# CIN CLI

CLI for delivering code to airgapped environments. Package Docker Compose applications with all dependencies for offline deployment.

## Installation

```bash
npm install -g @croissan/cin
```

## Quick Start

```bash
# Initialize project
cin init

# Add repositories
cin repo add git@github.com:your-org/backend.git --key deploy
cin repo add git@github.com:your-org/frontend.git --key deploy

# Pull, build, and package
cin pull
cin build
cin pack --sign

# Transfer package to airgapped environment, then:
cin deploy package.tar.gz -t /opt/app
```

## Key Features

- **Offline Packaging** — Bundle Docker images, source code, and configs into a single archive
- **Delta Transfers** — Only transfer changed files between versions
- **Package Signing** — Ed25519 signatures for integrity verification
- **Rollback Support** — One-command rollback to previous versions
- **Secrets Management** — AES-256-GCM encrypted secrets
- **Lifecycle Hooks** — Pre/post deploy scripts and custom tasks

## Workflow

```
Laboratory (Internet)          Airgapped Environment
┌─────────────────────┐        ┌─────────────────────┐
│  cin pull           │        │                     │
│  cin build          │ ──────>│  cin verify         │
│  cin pack --sign    │  USB   │  cin deploy         │
│  cin delta          │        │  cin rollback       │
└─────────────────────┘        └─────────────────────┘
```

## Commands

| Command | Description |
|---------|-------------|
| `cin init` | Initialize project configuration |
| `cin repo add <url>` | Add git repository |
| `cin key add <name> <path>` | Add SSH key |
| `cin pull` | Pull updates from repositories |
| `cin build` | Build Docker images |
| `cin pack` | Create offline package |
| `cin delta <old> <new>` | Create incremental update |
| `cin deploy <package>` | Deploy to target environment |
| `cin rollback` | Rollback to previous version |
| `cin secrets setup` | Configure secrets |
| `cin logs collect` | Collect logs for diagnostics |

## Claude Code Skill

Install the CIN CLI skill for Claude Code to get intelligent assistance:

```bash
# Install skill from repository
claude skill install github:CroissanStudioDev/cin
```

The skill provides:
- Command reference and examples
- Workflow guidance for airgapped deployments
- Configuration file templates
- Troubleshooting assistance

## Configuration

### Project Config (`.cin/config.yaml`)

```yaml
version: 1
project:
  name: "my-product"
  type: "docker-compose"
repositories:
  - name: backend
    url: "git@github.com:org/backend.git"
    branch: main
    ssh_key: deploy-key
```

### Hooks (`.cin/hooks.yaml`)

```yaml
version: 1
hooks:
  pre-deploy:
    - name: "Backup database"
      run: "docker exec db pg_dump > backup.sql"
  post-deploy:
    - name: "Health check"
      run: "curl -f http://localhost/health"
```

## Requirements

- Node.js 20+
- Git 2.30+
- Docker 20.10+
- Docker Compose v2.0+

## License

MIT
