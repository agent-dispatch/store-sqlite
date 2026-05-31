# @agent-dispatch/store-sqlite

[![npm](https://img.shields.io/npm/v/@agent-dispatch/store-sqlite.svg)](https://www.npmjs.com/package/@agent-dispatch/store-sqlite)
[![CI](https://github.com/agent-dispatch/store-sqlite/actions/workflows/ci.yml/badge.svg)](https://github.com/agent-dispatch/store-sqlite/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@agent-dispatch/store-sqlite.svg)](https://www.npmjs.com/package/@agent-dispatch/store-sqlite)

SQLite persistence for local AgentDispatch deployments.

## Why it exists

Cloud subagent tasks are long-running and must survive lead-agent restarts. This package stores task records, provider references, event sequences, artifacts, and cleanup state in a local SQLite database so MCP clients can poll status and retrieve results later.

## Stored records

- Task metadata: provider, account profile, capability, task type, target, and input summary.
- Provider refs: runtime ARNs, runtime IDs, session IDs, invocation IDs, and adapter-specific details.
- Event stream: lifecycle, log, progress, artifact, result, and error events with durable sequence numbers.
- Artifacts: provider-neutral references to output files or remote artifact locations.
- Cleanup state: whether per-task runtime resources were cleaned up, skipped, or failed.

## Install

```bash
npm install @agent-dispatch/store-sqlite
```

## Usage

```ts
import { createSqliteStore } from "@agent-dispatch/store-sqlite";

const store = createSqliteStore({
  path: "./.agentdispatch/tasks.sqlite"
});
```

Use it with `@agent-dispatch/core`, `@agent-dispatch/mcp-server`, or the CLI-generated config.

## Scale path

SQLite is the V1 OSS default because it is simple, durable, and local. The core store interface is intentionally separate so future deployments can swap in Postgres for task state, object storage for artifacts, and Redis or queues for streaming.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

See the [release workflow](https://github.com/agent-dispatch/store-sqlite/blob/main/docs/release.md) for npm Trusted Publisher setup, provenance publishing, and upstream package order.
