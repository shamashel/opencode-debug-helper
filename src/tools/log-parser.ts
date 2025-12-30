import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  parseLogContent,
  filterDebugHelperOutput,
  filterErrors,
  groupByMarker,
  extractDebugValue,
  summarizeLogAnalysis,
} from "../utils/log-patterns.js";
import { getMarkers } from "../utils/persistence.js";

export const parseLogsTool: ToolDefinition = tool({
  description: `Parse log output to extract errors, warnings, and DEBUG-HELPER marker output.
Accepts raw log content or a file path. Returns structured analysis.`,
  args: {
    content: tool.schema.string().optional().describe("Raw log content to parse"),
    file_path: tool.schema.string().optional().describe("Path to log file"),
    filter: tool.schema
      .enum(["all", "errors", "debug-helper", "warnings"])
      .optional()
      .describe("Filter results. Default: all"),
  },
  async execute(args) {
    const { content: rawContent, file_path, filter = "all" } = args;

    let logContent: string;

    if (file_path) {
      if (!existsSync(file_path)) {
        return `Error: Log file not found: ${file_path}`;
      }
      logContent = await readFile(file_path, "utf-8");
    } else if (rawContent) {
      logContent = rawContent;
    } else {
      return `Error: Provide either 'content' or 'file_path'`;
    }

    let matches = parseLogContent(logContent);

    switch (filter) {
      case "errors":
        matches = filterErrors(matches);
        break;
      case "debug-helper":
        matches = filterDebugHelperOutput(matches);
        break;
      case "warnings":
        matches = matches.filter((m) => m.type === "warning");
        break;
    }

    if (matches.length === 0) {
      return `No ${filter === "all" ? "notable entries" : filter} found in logs`;
    }

    const summary = summarizeLogAnalysis(matches);

    let output = `## Log Analysis\n\n`;
    output += `| Metric | Count |\n|--------|-------|\n`;
    output += `| Total matches | ${summary.total} |\n`;
    output += `| Errors | ${summary.errors} |\n`;
    output += `| Warnings | ${summary.warnings} |\n`;
    output += `| Debug markers | ${summary.debug_markers} |\n`;

    if (summary.marker_ids.length > 0) {
      output += `\n### Active Marker IDs\n`;
      output += summary.marker_ids.map((id) => `- \`${id}\``).join("\n");
    }

    output += `\n\n### Matches\n\n`;

    for (const match of matches.slice(0, 50)) {
      const typeLabel =
        match.type === "error"
          ? "ERROR"
          : match.type === "warning"
            ? "WARN"
            : match.type === "debug-helper"
              ? `DEBUG[${match.marker_id}]`
              : match.type.toUpperCase();

      output += `**[${typeLabel}]** Line ${match.line}: \`${match.content.slice(0, 200)}\`\n`;

      if (match.details) {
        output += `\`\`\`\n${match.details.slice(0, 500)}\n\`\`\`\n`;
      }
    }

    if (matches.length > 50) {
      output += `\n... and ${matches.length - 50} more matches`;
    }

    return output;
  },
});

export const extractDebugValuesTool: ToolDefinition = tool({
  description: `Extract structured values from DEBUG-HELPER log output.
Groups output by marker ID and extracts label:value pairs.`,
  args: {
    content: tool.schema.string().optional().describe("Raw log content"),
    file_path: tool.schema.string().optional().describe("Path to log file"),
    session_id: tool.schema.string().optional().describe("Session ID to correlate with known markers"),
  },
  async execute(args) {
    const { content: rawContent, file_path, session_id } = args;

    let logContent: string;

    if (file_path) {
      if (!existsSync(file_path)) {
        return `Error: Log file not found: ${file_path}`;
      }
      logContent = await readFile(file_path, "utf-8");
    } else if (rawContent) {
      logContent = rawContent;
    } else {
      return `Error: Provide either 'content' or 'file_path'`;
    }

    const allMatches = parseLogContent(logContent);
    const debugMatches = filterDebugHelperOutput(allMatches);

    if (debugMatches.length === 0) {
      return `No DEBUG-HELPER output found in logs`;
    }

    const grouped = groupByMarker(debugMatches);
    let knownMarkers: Map<string, { label: string; file_path: string }> = new Map();

    if (session_id) {
      const markers = await getMarkers(session_id);
      for (const m of markers) {
        knownMarkers.set(m.id, { label: m.label, file_path: m.file_path });
      }
    }

    let output = `## DEBUG-HELPER Values\n\n`;

    for (const [markerId, matches] of grouped) {
      const known = knownMarkers.get(markerId);
      const header = known
        ? `### Marker \`${markerId}\` (${known.label} @ ${known.file_path.split("/").pop()})`
        : `### Marker \`${markerId}\``;

      output += `${header}\n\n`;
      output += `| Occurrence | Label | Value |\n|------------|-------|-------|\n`;

      let i = 1;
      for (const match of matches) {
        const extracted = extractDebugValue(match.content);
        if (extracted) {
          const truncatedValue = extracted.value.length > 100 ? extracted.value.slice(0, 100) + "..." : extracted.value;
          output += `| ${i++} | ${extracted.label} | \`${truncatedValue}\` |\n`;
        }
      }

      output += `\n`;
    }

    return output;
  },
});

export const correlateLogsWithMarkersTool: ToolDefinition = tool({
  description: `Correlate log output with active instrumentation markers to identify execution flow.
Shows which markers were hit and in what order.`,
  args: {
    session_id: tool.schema.string().describe("Debug session ID"),
    content: tool.schema.string().optional().describe("Raw log content"),
    file_path: tool.schema.string().optional().describe("Path to log file"),
  },
  async execute(args) {
    const { session_id, content: rawContent, file_path } = args;

    let logContent: string;

    if (file_path) {
      if (!existsSync(file_path)) {
        return `Error: Log file not found: ${file_path}`;
      }
      logContent = await readFile(file_path, "utf-8");
    } else if (rawContent) {
      logContent = rawContent;
    } else {
      return `Error: Provide either 'content' or 'file_path'`;
    }

    const markers = await getMarkers(session_id);

    if (markers.length === 0) {
      return `No markers in session \`${session_id}\` to correlate`;
    }

    const allMatches = parseLogContent(logContent);
    const debugMatches = filterDebugHelperOutput(allMatches);
    const errorMatches = filterErrors(allMatches);

    const hitMarkers = new Set<string>();
    const markerOrder: { markerId: string; line: number }[] = [];

    for (const match of debugMatches) {
      if (match.marker_id) {
        if (!hitMarkers.has(match.marker_id)) {
          markerOrder.push({ markerId: match.marker_id, line: match.line });
        }
        hitMarkers.add(match.marker_id);
      }
    }

    let output = `## Execution Flow Analysis\n\n`;

    output += `### Marker Status\n\n`;
    output += `| Marker | Label | File | Status |\n`;
    output += `|--------|-------|------|--------|\n`;

    for (const m of markers) {
      const hit = hitMarkers.has(m.id);
      const status = hit ? "HIT" : "NOT HIT";
      const shortPath = m.file_path.split("/").slice(-2).join("/");
      output += `| \`${m.id}\` | ${m.label} | ${shortPath} | ${status} |\n`;
    }

    if (markerOrder.length > 0) {
      output += `\n### Execution Order\n\n`;
      output += `\`\`\`\n`;
      for (let i = 0; i < markerOrder.length; i++) {
        const { markerId } = markerOrder[i];
        const marker = markers.find((m) => m.id === markerId);
        const label = marker?.label || "unknown";
        output += `${i + 1}. ${label} [${markerId}]\n`;
      }
      output += `\`\`\`\n`;
    }

    if (errorMatches.length > 0) {
      output += `\n### Errors Detected (${errorMatches.length})\n\n`;
      for (const err of errorMatches.slice(0, 5)) {
        output += `- Line ${err.line}: \`${err.content.slice(0, 150)}\`\n`;
      }
      if (errorMatches.length > 5) {
        output += `- ... and ${errorMatches.length - 5} more\n`;
      }
    }

    const missedMarkers = markers.filter((m) => !hitMarkers.has(m.id));
    if (missedMarkers.length > 0) {
      output += `\n### Potential Issues\n\n`;
      output += `${missedMarkers.length} marker(s) were NOT hit during execution:\n`;
      for (const m of missedMarkers) {
        output += `- \`${m.id}\` (${m.label}) at ${m.file_path}:${m.line_start}\n`;
      }
      output += `\nThis may indicate the code path was not reached, or there was an early exit/error.`;
    }

    return output;
  },
});
