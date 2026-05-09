# @agentdispatch/store-sqlite

Local durable storage for AgentDispatch OSS usage.

- SQLite stores tasks, sessions, runtimes, events, and artifact metadata.
- Filesystem files store log streams and artifact payloads.
- The public surface implements `TaskStore` from `@agentdispatch/core`.
