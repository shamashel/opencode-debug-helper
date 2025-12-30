import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  getPatternForFile,
  generateMarkerId,
  buildInstrumentationBlock,
  findInstrumentationBlocks,
  removeInstrumentationBlock,
  removeAllInstrumentationBlocks,
  type InstrumentationMarker,
} from "../utils/instrumentation-patterns.js";
import {
  loadSession,
  createSession,
  addMarker,
  removeMarker as removeMarkerFromSession,
  getMarkers,
  clearMarkers,
} from "../utils/persistence.js";

export const addInstrumentationTool: ToolDefinition = tool({
  description: `Add debug instrumentation (logging) to a file at a specific line.
Inserts a console.log/print statement wrapped in DEBUG-HELPER markers.
Supports: JS/TS (.js, .jsx, .ts, .tsx), Python (.py), Rust (.rs), Go (.go).
Returns the marker ID for tracking.`,
  args: {
    session_id: tool.schema.string().describe("Debug session ID for tracking markers"),
    file_path: tool.schema.string().describe("Absolute path to the file"),
    line: tool.schema.number().describe("Line number to insert instrumentation AFTER"),
    label: tool.schema.string().describe("Label for the log output (e.g., 'before fetch', 'user data')"),
    expression: tool.schema.string().optional().describe("Variable/expression to log. If omitted, logs checkpoint only."),
  },
  async execute(args) {
    const { session_id, file_path, line, label, expression } = args;

    if (!existsSync(file_path)) {
      return `Error: File not found: ${file_path}`;
    }

    const pattern = getPatternForFile(file_path);
    if (!pattern) {
      return `Error: Unsupported file type. Supported: ${[".js", ".jsx", ".ts", ".tsx", ".py", ".rs", ".go"].join(", ")}`;
    }

    let session = await loadSession(session_id);
    if (!session) {
      session = await createSession(session_id, process.cwd());
    }

    const content = await readFile(file_path, "utf-8");
    const lines = content.split("\n");

    if (line < 1 || line > lines.length) {
      return `Error: Line ${line} out of range (file has ${lines.length} lines)`;
    }

    const targetLine = lines[line - 1];
    const indent = targetLine.match(/^(\s*)/)?.[1] || "";

    const markerId = generateMarkerId();
    const block = buildInstrumentationBlock(pattern, markerId, label, expression, indent);

    lines.splice(line, 0, block);
    await writeFile(file_path, lines.join("\n"));

    const marker: InstrumentationMarker = {
      id: markerId,
      file_path,
      line_start: line + 1,
      line_end: line + 3,
      label,
      expression,
      created_at: new Date().toISOString(),
    };
    await addMarker(session_id, marker);

    return `Added instrumentation marker \`${markerId}\` at ${file_path}:${line + 1}\n\nInserted:\n\`\`\`\n${block}\n\`\`\``;
  },
});

export const removeInstrumentationTool: ToolDefinition = tool({
  description: `Remove a specific debug instrumentation marker from a file by its ID.`,
  args: {
    session_id: tool.schema.string().describe("Debug session ID"),
    marker_id: tool.schema.string().describe("Marker ID to remove (e.g., 'abc12345')"),
  },
  async execute(args) {
    const { session_id, marker_id } = args;

    const markers = await getMarkers(session_id);
    const marker = markers.find((m) => m.id === marker_id);

    if (!marker) {
      return `Error: Marker \`${marker_id}\` not found in session \`${session_id}\``;
    }

    if (!existsSync(marker.file_path)) {
      await removeMarkerFromSession(session_id, marker_id);
      return `Warning: File ${marker.file_path} no longer exists. Removed marker from session.`;
    }

    const content = await readFile(marker.file_path, "utf-8");
    const newContent = removeInstrumentationBlock(content, marker_id);

    if (content === newContent) {
      await removeMarkerFromSession(session_id, marker_id);
      return `Warning: Marker \`${marker_id}\` not found in file (may have been manually removed). Cleaned up session.`;
    }

    await writeFile(marker.file_path, newContent);
    await removeMarkerFromSession(session_id, marker_id);

    return `Removed marker \`${marker_id}\` from ${marker.file_path}`;
  },
});

export const listInstrumentationTool: ToolDefinition = tool({
  description: `List all active debug instrumentation markers in a session.`,
  args: {
    session_id: tool.schema.string().describe("Debug session ID"),
  },
  async execute(args) {
    const { session_id } = args;

    const markers = await getMarkers(session_id);

    if (markers.length === 0) {
      return `No active instrumentation markers in session \`${session_id}\``;
    }

    let output = `## Active Instrumentation Markers (${markers.length})\n\n`;
    output += `| ID | File | Line | Label | Expression |\n`;
    output += `|----|------|------|-------|------------|\n`;

    for (const m of markers) {
      const shortPath = m.file_path.split("/").slice(-2).join("/");
      output += `| \`${m.id}\` | ${shortPath} | ${m.line_start} | ${m.label} | ${m.expression || "-"} |\n`;
    }

    return output;
  },
});

export const removeAllInstrumentationTool: ToolDefinition = tool({
  description: `Remove ALL debug instrumentation markers from all files in a session. Use with caution.`,
  args: {
    session_id: tool.schema.string().describe("Debug session ID"),
  },
  async execute(args) {
    const { session_id } = args;

    const markers = await getMarkers(session_id);

    if (markers.length === 0) {
      return `No markers to remove in session \`${session_id}\``;
    }

    const fileMap = new Map<string, InstrumentationMarker[]>();
    for (const m of markers) {
      const existing = fileMap.get(m.file_path) || [];
      existing.push(m);
      fileMap.set(m.file_path, existing);
    }

    let removed = 0;
    let errors: string[] = [];

    for (const [filePath, fileMarkers] of fileMap) {
      if (!existsSync(filePath)) {
        errors.push(`File not found: ${filePath}`);
        continue;
      }

      try {
        const content = await readFile(filePath, "utf-8");
        const newContent = removeAllInstrumentationBlocks(content);
        await writeFile(filePath, newContent);
        removed += fileMarkers.length;
      } catch (err) {
        errors.push(`Failed to clean ${filePath}: ${err}`);
      }
    }

    await clearMarkers(session_id);

    let output = `Removed ${removed} markers from ${fileMap.size} file(s)`;
    if (errors.length > 0) {
      output += `\n\nWarnings:\n${errors.map((e) => `- ${e}`).join("\n")}`;
    }

    return output;
  },
});

export const scanFileInstrumentationTool: ToolDefinition = tool({
  description: `Scan a file for existing DEBUG-HELPER instrumentation blocks. Useful to verify what's currently instrumented.`,
  args: {
    file_path: tool.schema.string().describe("Absolute path to the file"),
  },
  async execute(args) {
    const { file_path } = args;

    if (!existsSync(file_path)) {
      return `Error: File not found: ${file_path}`;
    }

    const content = await readFile(file_path, "utf-8");
    const blocks = findInstrumentationBlocks(content, file_path);

    if (blocks.length === 0) {
      return `No DEBUG-HELPER instrumentation found in ${file_path}`;
    }

    let output = `## Found ${blocks.length} instrumentation block(s) in ${file_path}\n\n`;
    for (const block of blocks) {
      output += `### Marker: \`${block.markerId}\` (lines ${block.startLine}-${block.endLine})\n`;
      output += `\`\`\`\n${block.content}\n\`\`\`\n\n`;
    }

    return output;
  },
});
