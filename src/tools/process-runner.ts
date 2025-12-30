import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { spawn, type ChildProcess, type SpawnOptionsWithoutStdio } from "node:child_process";
import { loadSession, createSession, updateSession } from "../utils/persistence.js";

interface ProcessInfo {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  pid: number;
  startedAt: string;
  outputBuffer: string[];
}

const MAX_OUTPUT_LINES = 500;
const runningProcesses = new Map<string, { process: ChildProcess; info: ProcessInfo }>();

function getProcessKey(sessionId: string, name: string): string {
  return `${sessionId}:${name}`;
}

export const startProcessTool: ToolDefinition = tool({
  description: `Start a process for debugging. Runs the command in background and captures output.
Use this to run your application with instrumentation and capture debug logs.
The process runs until stopped or the session ends.`,
  args: {
    session_id: tool.schema.string().describe("Debug session ID"),
    name: tool.schema.string().describe("Process name for reference (e.g., 'app', 'server')"),
    command: tool.schema.string().describe("Command to run (e.g., 'node', 'python', 'cargo')"),
    args: tool.schema.array(tool.schema.string()).optional().describe("Command arguments (e.g., ['src/index.js'])"),
    cwd: tool.schema.string().optional().describe("Working directory (defaults to session directory)"),
  },
  async execute(params) {
    const { session_id, name, command, args = [], cwd } = params;

    const key = getProcessKey(session_id, name);

    if (runningProcesses.has(key)) {
      const existing = runningProcesses.get(key)!;
      return `Error: Process '${name}' already running (PID: ${existing.info.pid}). Stop it first.`;
    }

    let session = await loadSession(session_id);
    if (!session) {
      session = await createSession(session_id, cwd || process.cwd());
    }

    const workDir = cwd || session.directory;

    const spawnOptions: SpawnOptionsWithoutStdio = {
      cwd: workDir,
      env: process.env as NodeJS.ProcessEnv,
      detached: false,
    };

    const child = spawn(command, args, spawnOptions);

    if (!child.pid) {
      return `Error: Failed to start process '${name}'. Command: ${command} ${args.join(" ")}`;
    }

    const pid = child.pid;

    const info: ProcessInfo = {
      name,
      command,
      args,
      cwd: workDir,
      pid,
      startedAt: new Date().toISOString(),
      outputBuffer: [],
    };

    const appendOutput = (data: Buffer, stream: "stdout" | "stderr") => {
      const lines = data.toString().split("\n").filter((l: string) => l.length > 0);
      for (const line of lines) {
        const entry = `[${stream}] ${line}`;
        info.outputBuffer.push(entry);
        if (info.outputBuffer.length > MAX_OUTPUT_LINES) {
          info.outputBuffer.shift();
        }
      }
    };

    child.stdout?.on("data", (data: Buffer) => appendOutput(data, "stdout"));
    child.stderr?.on("data", (data: Buffer) => appendOutput(data, "stderr"));

    child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      info.outputBuffer.push(`[system] Process exited with code ${code}, signal ${signal}`);
      runningProcesses.delete(key);
    });

    child.on("error", (err: Error) => {
      info.outputBuffer.push(`[system] Process error: ${err.message}`);
      runningProcesses.delete(key);
    });

    runningProcesses.set(key, { process: child, info });

    await updateSession(session_id, {
      ...session,
      processes: [...(session.processes || []), { name, pid, startedAt: info.startedAt }],
    });

    return `Started process '${name}' (PID: ${pid})
Command: ${command} ${args.join(" ")}
Working directory: ${workDir}

Use \`capture_output\` to see logs, \`stop_process\` to terminate.`;
  },
});

export const stopProcessTool: ToolDefinition = tool({
  description: `Stop a running debug process by name.`,
  args: {
    session_id: tool.schema.string().describe("Debug session ID"),
    name: tool.schema.string().describe("Process name to stop"),
    signal: tool.schema.enum(["SIGTERM", "SIGKILL"]).optional().describe("Signal to send (default: SIGTERM)"),
  },
  async execute(params) {
    const { session_id, name, signal = "SIGTERM" } = params;

    const key = getProcessKey(session_id, name);
    const entry = runningProcesses.get(key);

    if (!entry) {
      return `Error: No running process named '${name}' in session '${session_id}'`;
    }

    const { process: child, info } = entry;

    try {
      const killed = child.kill(signal as NodeJS.Signals);
      if (!killed) {
        return `Warning: Process '${name}' (PID: ${info.pid}) may have already exited`;
      }
      runningProcesses.delete(key);

      const session = await loadSession(session_id);
      if (session) {
        await updateSession(session_id, {
          ...session,
          processes: (session.processes || []).filter((p) => p.name !== name),
        });
      }

      return `Stopped process '${name}' (PID: ${info.pid}) with ${signal}`;
    } catch (err) {
      return `Error stopping process '${name}': ${err}`;
    }
  },
});

export const captureOutputTool: ToolDefinition = tool({
  description: `Capture recent output from a running debug process.
Returns the last N lines of stdout/stderr. Use this to check for debug logs and errors.`,
  args: {
    session_id: tool.schema.string().describe("Debug session ID"),
    name: tool.schema.string().describe("Process name"),
    lines: tool.schema.number().optional().describe("Number of lines to return (default: 50, max: 500)"),
    filter: tool.schema.string().optional().describe("Filter output by substring (case-insensitive)"),
  },
  async execute(params) {
    const { session_id, name, lines = 50, filter } = params;

    const key = getProcessKey(session_id, name);
    const entry = runningProcesses.get(key);

    if (!entry) {
      return `Error: No running process named '${name}' in session '${session_id}'`;
    }

    const { info } = entry;
    let output = info.outputBuffer;

    if (filter) {
      const lowerFilter = filter.toLowerCase();
      output = output.filter((line) => line.toLowerCase().includes(lowerFilter));
    }

    const requestedLines = Math.min(lines, MAX_OUTPUT_LINES);
    const recentLines = output.slice(-requestedLines);

    if (recentLines.length === 0) {
      return filter
        ? `No output matching '${filter}' from process '${name}'`
        : `No output yet from process '${name}'`;
    }

    let result = `## Output from '${name}' (PID: ${info.pid})\n`;
    result += `Showing ${recentLines.length} line(s)`;
    if (filter) result += ` matching '${filter}'`;
    result += `\n\n\`\`\`\n${recentLines.join("\n")}\n\`\`\``;

    return result;
  },
});

export const listProcessesTool: ToolDefinition = tool({
  description: `List all running debug processes in a session.`,
  args: {
    session_id: tool.schema.string().describe("Debug session ID"),
  },
  async execute(params) {
    const { session_id } = params;

    const sessionProcesses: ProcessInfo[] = [];
    for (const [key, entry] of runningProcesses) {
      if (key.startsWith(`${session_id}:`)) {
        sessionProcesses.push(entry.info);
      }
    }

    if (sessionProcesses.length === 0) {
      return `No running processes in session '${session_id}'`;
    }

    let output = `## Running Processes (${sessionProcesses.length})\n\n`;
    output += `| Name | PID | Command | Started | Output Lines |\n`;
    output += `|------|-----|---------|---------|---------------|\n`;

    for (const p of sessionProcesses) {
      const cmd = `${p.command} ${p.args.slice(0, 2).join(" ")}${p.args.length > 2 ? "..." : ""}`;
      output += `| ${p.name} | ${p.pid} | ${cmd} | ${p.startedAt.slice(11, 19)} | ${p.outputBuffer.length} |\n`;
    }

    return output;
  },
});
