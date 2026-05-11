import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nowIso, type RuntimeRecord, type TaskRecord } from "@agent-dispatch/core";
import { SqliteTaskStore } from "../src/index.js";

let stateDir: string;
let store: SqliteTaskStore;

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "agentdispatch-store-"));
  store = new SqliteTaskStore({ stateDir });
});

afterEach(async () => {
  store.close();
  await rm(stateDir, { recursive: true, force: true });
});

describe("SqliteTaskStore", () => {
  it("applies migrations idempotently", () => {
    expect(store.appliedMigrations()).toEqual(["001_initial"]);
    const reopened = new SqliteTaskStore({ stateDir });
    expect(reopened.appliedMigrations()).toEqual(["001_initial"]);
  });

  it("persists tasks across store instances", async () => {
    const task = createTask("task_1");
    await store.saveTask(task);
    const reopened = new SqliteTaskStore({ stateDir });
    await expect(reopened.getTask("task_1")).resolves.toMatchObject({ id: "task_1", provider: "aws" });
  });

  it("updates runtime cleanup state across store instances", async () => {
    const runtime = createRuntime("runtime_1", "task_1");
    await store.saveRuntime(runtime);
    await store.updateRuntime("runtime_1", {
      status: "deleted",
      cleanupStatus: "completed",
      providerRefs: { runtimeId: "provider_runtime_1", cleanupId: "cleanup_1" },
      updatedAt: nowIso()
    });
    const reopened = new SqliteTaskStore({ stateDir });
    await expect(reopened.updateRuntime("runtime_1", { updatedAt: nowIso() })).resolves.toMatchObject({
      status: "deleted",
      cleanupStatus: "completed",
      providerRefs: { runtimeId: "provider_runtime_1", cleanupId: "cleanup_1" }
    });
  });

  it("paginates events by sequence", async () => {
    await store.appendEvent({ taskId: "task_1", type: "task.progress", message: "one" });
    await store.appendEvent({ taskId: "task_1", type: "task.progress", message: "two" });
    await store.appendEvent({ taskId: "task_1", type: "task.progress", message: "three" });

    const events = await store.listEvents("task_1", 1);
    expect(events.map((event) => event.message)).toEqual(["two", "three"]);
    expect(events.map((event) => event.sequence)).toEqual([2, 3]);
  });

  it("reads logs by cursor and limit", async () => {
    await store.appendLog("task_1", "abcdef");
    const first = await store.readLogs("task_1", 0, 2);
    const second = await store.readLogs("task_1", first.nextCursor, 3);

    expect(first).toMatchObject({ data: "ab", nextCursor: 2 });
    expect(second).toMatchObject({ data: "cde", nextCursor: 5 });
  });

  it("appends log chunks without rewriting existing content", async () => {
    await Promise.all(Array.from({ length: 25 }, (_, index) => store.appendLog("task_1", `${index}\n`)));
    const logs = await store.readLogs("task_1", 0, 10_000);

    for (let index = 0; index < 25; index += 1) {
      expect(logs.data).toContain(`${index}\n`);
    }
  });

  it("persists artifact metadata and files", async () => {
    const artifact = await store.saveArtifactFile("task_1", "result.txt", Buffer.from("done"), "text/plain");
    const artifacts = await store.listArtifacts("task_1");

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ id: artifact.id, kind: "file", contentType: "text/plain", sizeBytes: 4 });
    await expect(readFile(artifact.uri, "utf8")).resolves.toBe("done");
  });

  it("rejects artifact paths outside the task artifact directory", async () => {
    await expect(store.saveArtifactFile("task_1", "../escape.txt", Buffer.from("nope"))).rejects.toThrow("Artifact name");
    await expect(store.saveArtifactFile("task_1", "/tmp/escape.txt", Buffer.from("nope"))).rejects.toThrow("Artifact name");
    await expect(stat(join(stateDir, "artifacts", "escape.txt"))).rejects.toThrow();
  });

  it("closes the database connection explicitly", async () => {
    store.close();
    expect(() => store.appliedMigrations()).toThrow();
    store = new SqliteTaskStore({ stateDir });
    expect(store.appliedMigrations()).toEqual(["001_initial"]);
  });
});

function createTask(id: string): TaskRecord {
  const timestamp = nowIso();
  return {
    id,
    provider: "aws",
    accountProfile: "dev-aws",
    capability: "agent-runtime",
    taskType: "agent.run",
    target: { mode: "session" },
    input: { instruction: "run" },
    backend: "aws-agentcore",
    status: "queued",
    providerRefs: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function createRuntime(id: string, taskId: string): RuntimeRecord {
  const timestamp = nowIso();
  return {
    id,
    taskId,
    provider: "aws",
    accountProfile: "dev-aws",
    capability: "agent-runtime",
    backend: "aws-agentcore",
    status: "ready",
    providerRefs: { runtimeId: "provider_runtime_1" },
    cleanupStatus: "pending",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}
