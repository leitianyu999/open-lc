# Open LC

## 重要声明

本项目仅供学习、研究和个人技术参考使用。

本项目涉及的能力均基于网盘服务提供方的官方开放接口，不包含破坏、绕过、破解官方接口或服务限制的行为。当前项目仅面向已拥有正版 SVIP 会员权益的账号使用者，用于在合法、合规、符合服务条款的前提下进行本地化管理和调用。

使用者应自行确认其账号、接口调用、数据处理和使用场景符合相关法律法规、平台服务协议以及授权范围。任何超出个人学习研究范围的使用，尤其是未经授权的商业用途、批量化调用、转售、共享账号权益或其他违反平台规则的行为，均可能导致账号限制、封禁、IP 限制、权益回收或其他法律及商业风险。

因使用者违反法律法规、平台规则、服务协议或授权范围而产生的任何后果，包括但不限于限速、封号、数据损失、权益损失、纠纷、索赔或其他风险，均由使用者自行承担，与本项目作者无关。

## Overview

Open LC is the open-source LC Agent package exported from the LC monorepo.

It provides a local Agent API, a web console, desktop builds, Docker deployment, and the public LC v0 Broker protocol documents needed to build compatible Broker services.

## Features

- Local Agent API powered by Bun and Hono
- Web console built with Vite and React
- Desktop packaging through Electrobun
- Docker image for local or server deployment
- SQLite storage with Drizzle migrations
- Agent-facing Broker protocol documentation

## Download

Release assets are published when a `vX.Y.Z` tag is pushed.

| Target | Asset |
| --- | --- |
| macOS Apple Silicon | `stable-macos-arm64-LCAgent.dmg` |
| macOS Intel | `stable-macos-x64-LCAgent.dmg` |
| Windows x64 | `stable-win-x64-LCAgent-Setup.zip` |
| Linux x64 | `stable-linux-x64-LCAgent-Setup.tar.gz` |
| Docker | `ghcr.io/<owner>/open-lc:<version>` |

Docker images are built for `linux/amd64` and `linux/arm64`.

## Quick Start

### Docker

```sh
docker run --rm -p 3100:3100 -v open-lc-data:/data ghcr.io/<owner>/open-lc:<version>
```

The Docker image runs the Agent API and serves the built web console from the same process.

### Local Development

```sh
bun install
bun run dev:agent-api
bun run dev:agent-web
```

Defaults:

- Agent API: http://localhost:3100
- Agent Web: http://localhost:5174/#/
- SQLite database: `data/agent.sqlite`

### Desktop Development

```sh
bun run dev:agent-desktop
```

## Configuration

Agent settings can be configured from the local web console. `LC_AGENT_*` environment variables are also read as fallbacks.

Common runtime paths:

- Database: `LC_AGENT_DATABASE_URL`
- Web console build: `LC_AGENT_WEB_DIST_DIR`
- Database migrations: `LC_AGENT_MIGRATIONS_DIR`
- Temporary files are managed by the local Agent runtime.

Do not commit real cookies, generated direct links, local SQLite files, or local environment files.

## Broker Protocol

Open LC includes the public Agent-facing LC v0 Broker protocol so that third-party Broker implementations can be built without copying the official Broker service.

Start with:

- `docs/broker-protocol/README.md`
- `docs/broker-protocol/AGENT_API.md`
- `docs/broker-protocol/STATE_MACHINE.md`
- `docs/broker-protocol/ERROR_CODES.md`
- `docs/broker-protocol/POLLING_LEASE.md`

A compatible Broker must keep the Agent-facing HTTP contract and state behavior compatible. It does not need to copy the official Broker database schema, admin console, user frontend, or settlement implementation.

## Development

```sh
bun run build:agent-web
bun run build:agent-desktop
bun run typecheck
bun run db:agent:check
```

Database migration:

```sh
bun run db:agent:migrate
```

Schema and migrations live in:

- `agent/api/src/db/schema.ts`
- `agent/drizzle.config.ts`
- `agent/drizzle/`

## Release

The repository keeps Agent package versions as `0.0.0`. The release workflow injects the tag version during build.

Push a tag in this format:

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

GitHub Actions builds desktop artifacts, pushes the Docker image, and creates a GitHub Release with a table of download and image addresses.

## License

MIT License. See `LICENSE`.
