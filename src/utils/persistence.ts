import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import type { InstrumentationMarker } from "./instrumentation-patterns.js";

const BASE_DIR = join(tmpdir(), "opencode-debug-helper");

export interface ProcessEntry {
  name: string;
  pid: number;
  startedAt: string;
}

export interface SessionData {
  session_id: string;
  project_dir: string;
  directory: string;
  created_at: string;
  markers: InstrumentationMarker[];
  logs: LogEntry[];
  rca_history: RCAEntry[];
  processes?: ProcessEntry[];
}

export interface LogEntry {
  timestamp: string;
  marker_id?: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  source?: string;
}

export interface RCAEntry {
  timestamp: string;
  hypothesis: string;
  evidence: string[];
  outcome: "confirmed" | "rejected" | "inconclusive";
}

function getSessionPath(sessionId: string): string {
  return join(BASE_DIR, sessionId);
}

function getDataPath(sessionId: string): string {
  return join(getSessionPath(sessionId), "session.json");
}

export async function ensureBaseDir(): Promise<void> {
  await mkdir(BASE_DIR, { recursive: true });
}

export async function createSession(sessionId: string, projectDir: string): Promise<SessionData> {
  await ensureBaseDir();
  const sessionPath = getSessionPath(sessionId);
  await mkdir(sessionPath, { recursive: true });

  const data: SessionData = {
    session_id: sessionId,
    project_dir: projectDir,
    directory: projectDir,
    created_at: new Date().toISOString(),
    markers: [],
    logs: [],
    rca_history: [],
    processes: [],
  };

  await writeFile(getDataPath(sessionId), JSON.stringify(data, null, 2));
  return data;
}

export async function loadSession(sessionId: string): Promise<SessionData | null> {
  const dataPath = getDataPath(sessionId);
  if (!existsSync(dataPath)) {
    return null;
  }

  try {
    const content = await readFile(dataPath, "utf-8");
    return JSON.parse(content) as SessionData;
  } catch {
    return null;
  }
}

export async function saveSession(data: SessionData): Promise<void> {
  await ensureBaseDir();
  const sessionPath = getSessionPath(data.session_id);
  if (!existsSync(sessionPath)) {
    await mkdir(sessionPath, { recursive: true });
  }
  await writeFile(getDataPath(data.session_id), JSON.stringify(data, null, 2));
}

export async function updateSession(sessionId: string, updates: Partial<SessionData>): Promise<void> {
  const data = await loadSession(sessionId);
  if (!data) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  await saveSession({ ...data, ...updates, session_id: sessionId });
}

export async function deleteSession(sessionId: string): Promise<void> {
  const sessionPath = getSessionPath(sessionId);
  if (existsSync(sessionPath)) {
    await rm(sessionPath, { recursive: true, force: true });
  }
}

export async function listSessions(): Promise<string[]> {
  await ensureBaseDir();
  try {
    const entries = await readdir(BASE_DIR);
    const sessions: string[] = [];
    for (const entry of entries) {
      if (existsSync(getDataPath(entry))) {
        sessions.push(entry);
      }
    }
    return sessions;
  } catch {
    return [];
  }
}

export async function addMarker(sessionId: string, marker: InstrumentationMarker): Promise<void> {
  const data = await loadSession(sessionId);
  if (!data) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  data.markers.push(marker);
  await saveSession(data);
}

export async function removeMarker(sessionId: string, markerId: string): Promise<void> {
  const data = await loadSession(sessionId);
  if (!data) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  data.markers = data.markers.filter((m) => m.id !== markerId);
  await saveSession(data);
}

export async function getMarkers(sessionId: string): Promise<InstrumentationMarker[]> {
  const data = await loadSession(sessionId);
  return data?.markers || [];
}

export async function clearMarkers(sessionId: string): Promise<void> {
  const data = await loadSession(sessionId);
  if (!data) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  data.markers = [];
  await saveSession(data);
}

export async function addLog(sessionId: string, entry: LogEntry): Promise<void> {
  const data = await loadSession(sessionId);
  if (!data) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  data.logs.push(entry);
  await saveSession(data);
}

export async function getLogs(sessionId: string): Promise<LogEntry[]> {
  const data = await loadSession(sessionId);
  return data?.logs || [];
}

export async function clearLogs(sessionId: string): Promise<void> {
  const data = await loadSession(sessionId);
  if (!data) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  data.logs = [];
  await saveSession(data);
}

export async function addRCAEntry(sessionId: string, entry: RCAEntry): Promise<void> {
  const data = await loadSession(sessionId);
  if (!data) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  data.rca_history.push(entry);
  await saveSession(data);
}

export async function getRCAHistory(sessionId: string): Promise<RCAEntry[]> {
  const data = await loadSession(sessionId);
  return data?.rca_history || [];
}

export async function writeLogFile(sessionId: string, filename: string, content: string): Promise<string> {
  const sessionPath = getSessionPath(sessionId);
  await mkdir(sessionPath, { recursive: true });
  const logPath = join(sessionPath, filename);
  await writeFile(logPath, content);
  return logPath;
}

export async function readLogFile(sessionId: string, filename: string): Promise<string | null> {
  const logPath = join(getSessionPath(sessionId), filename);
  if (!existsSync(logPath)) {
    return null;
  }
  return readFile(logPath, "utf-8");
}

export async function appendLogFile(sessionId: string, filename: string, content: string): Promise<void> {
  const logPath = join(getSessionPath(sessionId), filename);
  const existing = existsSync(logPath) ? await readFile(logPath, "utf-8") : "";
  await writeFile(logPath, existing + content);
}
