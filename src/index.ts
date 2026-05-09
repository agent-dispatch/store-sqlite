import Database from "better-sqlite3";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createId, nowIso, type ArtifactRecord, type LogChunk, type RuntimeEvent, type RuntimeRecord, type SessionRecord, type TaskRecord, type TaskStore } from "@agentdispatch/core";

export interface SqliteTaskStoreOptions {
  stateDir: string;
}

export class SqliteTaskStore implements TaskStore {
  private readonly db: Database.Database;
  private readonly stateDir: string;

  constructor(options: SqliteTaskStoreOptions) {
    this.stateDir = options.stateDir;
    this.db = new Database(join(options.stateDir, "agentdispatch.sqlite"));
    this.initialize();
  }

  async ensureReady(): Promise<void> {
    await mkdir(join(this.stateDir, "logs"), { recursive: true });
    await mkdir(join(this.stateDir, "artifacts"), { recursive: true });
  }

  async saveTask(task: TaskRecord): Promise<void> {
    this.db.prepare("insert into tasks (id, data, status, updated_at) values (?, ?, ?, ?)").run(task.id, JSON.stringify(task), task.status, task.updatedAt);
  }

  async getTask(taskId: string): Promise<TaskRecord | undefined> {
    const row = this.db.prepare("select data from tasks where id = ?").get(taskId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as TaskRecord : undefined;
  }

  async updateTask(taskId: string, patch: Partial<TaskRecord>): Promise<TaskRecord> {
    const current = await this.getTask(taskId);
    if (!current) throw new Error(`Task ${taskId} was not found.`);
    const next = { ...current, ...patch };
    this.db.prepare("update tasks set data = ?, status = ?, updated_at = ? where id = ?").run(JSON.stringify(next), next.status, next.updatedAt, taskId);
    return next;
  }

  async listTasks(): Promise<TaskRecord[]> {
    return this.db.prepare("select data from tasks order by updated_at desc").all().map((row: any) => JSON.parse(row.data));
  }

  async saveRuntime(runtime: RuntimeRecord): Promise<void> {
    this.db.prepare("insert or replace into runtimes (id, task_id, data, status, updated_at) values (?, ?, ?, ?, ?)").run(runtime.id, runtime.taskId, JSON.stringify(runtime), runtime.status, runtime.updatedAt);
  }

  async saveSession(session: SessionRecord): Promise<void> {
    this.db.prepare("insert or replace into sessions (id, task_id, data, status, updated_at) values (?, ?, ?, ?, ?)").run(session.id, session.taskId, JSON.stringify(session), session.status, session.updatedAt);
  }

  async appendEvent(event: RuntimeEvent): Promise<RuntimeEvent> {
    const sequence = Number((this.db.prepare("select coalesce(max(sequence), 0) as sequence from events where task_id = ?").get(event.taskId) as any).sequence) + 1;
    const stored = { ...event, id: event.id ?? createId("evt"), sequence, timestamp: event.timestamp ?? nowIso() };
    this.db.prepare("insert into events (id, task_id, sequence, type, data, created_at) values (?, ?, ?, ?, ?, ?)").run(stored.id, stored.taskId, sequence, stored.type, JSON.stringify(stored), stored.timestamp);
    return stored;
  }

  async listEvents(taskId: string, afterSequence = 0): Promise<RuntimeEvent[]> {
    return this.db.prepare("select data from events where task_id = ? and sequence > ? order by sequence asc").all(taskId, afterSequence).map((row: any) => JSON.parse(row.data));
  }

  async appendLog(taskId: string, chunk: string): Promise<void> {
    await this.ensureReady();
    const path = this.logPath(taskId);
    const existing = await readFile(path, "utf8").catch(() => "");
    await writeFile(path, `${existing}${chunk}`);
  }

  async readLogs(taskId: string, cursor = 0, limit = 64_000): Promise<LogChunk> {
    const path = this.logPath(taskId);
    const data = await readFile(path, "utf8").catch(() => "");
    const slice = data.slice(cursor, cursor + limit);
    return { taskId, cursor, nextCursor: cursor + slice.length, data: slice };
  }

  async saveArtifact(artifact: ArtifactRecord): Promise<void> {
    this.db.prepare("insert or replace into artifacts (id, task_id, data, created_at) values (?, ?, ?, ?)").run(artifact.id, artifact.taskId, JSON.stringify(artifact), artifact.createdAt);
  }

  async listArtifacts(taskId: string): Promise<ArtifactRecord[]> {
    return this.db.prepare("select data from artifacts where task_id = ? order by created_at asc").all(taskId).map((row: any) => JSON.parse(row.data));
  }

  async saveArtifactFile(taskId: string, name: string, bytes: Uint8Array, contentType = "application/octet-stream"): Promise<ArtifactRecord> {
    await this.ensureReady();
    const uri = join(this.stateDir, "artifacts", taskId, name);
    await mkdir(dirname(uri), { recursive: true });
    await writeFile(uri, bytes);
    const sizeBytes = (await stat(uri)).size;
    const artifact = { id: createId("art"), taskId, kind: "file", uri, contentType, sizeBytes, createdAt: nowIso() };
    await this.saveArtifact(artifact);
    return artifact;
  }

  private initialize(): void {
    this.db.exec(`
      create table if not exists tasks (id text primary key, data text not null, status text not null, updated_at text not null);
      create table if not exists runtimes (id text primary key, task_id text not null, data text not null, status text not null, updated_at text not null);
      create table if not exists sessions (id text primary key, task_id text not null, data text not null, status text not null, updated_at text not null);
      create table if not exists events (id text primary key, task_id text not null, sequence integer not null, type text not null, data text not null, created_at text not null);
      create unique index if not exists events_task_sequence on events (task_id, sequence);
      create table if not exists artifacts (id text primary key, task_id text not null, data text not null, created_at text not null);
    `);
  }

  private logPath(taskId: string): string {
    return join(this.stateDir, "logs", `${taskId}.log`);
  }
}
