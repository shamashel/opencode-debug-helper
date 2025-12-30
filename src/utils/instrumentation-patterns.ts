import type { ProjectInfo } from "./project-types.js";

export interface InstrumentationPattern {
  /** Use {marker_id}, {label}, {expression} placeholders */
  log_template: string;
  start_marker: (markerId: string) => string;
  end_marker: (markerId: string) => string;
  extensions: string[];
  comment: { single: string; multi_start?: string; multi_end?: string };
}

const JS_TS_PATTERN: InstrumentationPattern = {
  log_template: `console.log("[{marker_id}] {label}:", {expression});`,
  start_marker: (id) => `// [DEBUG-HELPER:${id}] START`,
  end_marker: (id) => `// [DEBUG-HELPER:${id}] END`,
  extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"],
  comment: { single: "//", multi_start: "/*", multi_end: "*/" },
};

const PYTHON_PATTERN: InstrumentationPattern = {
  log_template: `print(f"[{marker_id}] {label}: {{expression}}")`,
  start_marker: (id) => `# [DEBUG-HELPER:${id}] START`,
  end_marker: (id) => `# [DEBUG-HELPER:${id}] END`,
  extensions: [".py"],
  comment: { single: "#" },
};

const RUST_PATTERN: InstrumentationPattern = {
  log_template: `eprintln!("[{marker_id}] {label}: {:?}", {expression});`,
  start_marker: (id) => `// [DEBUG-HELPER:${id}] START`,
  end_marker: (id) => `// [DEBUG-HELPER:${id}] END`,
  extensions: [".rs"],
  comment: { single: "//", multi_start: "/*", multi_end: "*/" },
};

const GO_PATTERN: InstrumentationPattern = {
  log_template: `fmt.Printf("[{marker_id}] {label}: %+v\\n", {expression})`,
  start_marker: (id) => `// [DEBUG-HELPER:${id}] START`,
  end_marker: (id) => `// [DEBUG-HELPER:${id}] END`,
  extensions: [".go"],
  comment: { single: "//", multi_start: "/*", multi_end: "*/" },
};

export const PATTERNS_BY_TYPE: Record<ProjectInfo["type"], InstrumentationPattern> = {
  node: JS_TS_PATTERN,
  python: PYTHON_PATTERN,
  rust: RUST_PATTERN,
  go: GO_PATTERN,
  polyglot: JS_TS_PATTERN,
  unknown: JS_TS_PATTERN,
};

export const PATTERNS_BY_EXTENSION: Record<string, InstrumentationPattern> = {};

for (const pattern of [JS_TS_PATTERN, PYTHON_PATTERN, RUST_PATTERN, GO_PATTERN]) {
  for (const ext of pattern.extensions) {
    PATTERNS_BY_EXTENSION[ext] = pattern;
  }
}

export function getPatternForFile(filePath: string): InstrumentationPattern | null {
  const ext = filePath.substring(filePath.lastIndexOf("."));
  return PATTERNS_BY_EXTENSION[ext] || null;
}

export function getPatternForProjectType(type: ProjectInfo["type"]): InstrumentationPattern {
  return PATTERNS_BY_TYPE[type];
}

export interface InstrumentationMarker {
  id: string;
  file_path: string;
  line_start: number;
  line_end: number;
  label: string;
  expression?: string;
  created_at: string;
}

export function generateMarkerId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function buildInstrumentationBlock(
  pattern: InstrumentationPattern,
  markerId: string,
  label: string,
  expression?: string,
  indent = ""
): string {
  const lines: string[] = [];
  lines.push(`${indent}${pattern.start_marker(markerId)}`);

  if (expression) {
    const logLine = pattern.log_template
      .replace("{marker_id}", markerId)
      .replace("{label}", label)
      .replace("{expression}", expression)
      .replace("{{expression}}", `{${expression}}`); // Python f-string uses {{}} for literal braces
    lines.push(`${indent}${logLine}`);
  } else {
    const logLine = pattern.log_template
      .replace("{marker_id}", markerId)
      .replace("{label}", label)
      .replace(", {expression}", "")
      .replace(": {expression}", "")
      .replace(": {{expression}}", "")
      .replace(": {:?}\", {expression}", "\"")
      .replace(": %+v\\n\", {expression}", "\\n\"");
    lines.push(`${indent}${logLine}`);
  }

  lines.push(`${indent}${pattern.end_marker(markerId)}`);
  return lines.join("\n");
}

export function extractMarkerId(line: string): string | null {
  const match = line.match(/\[DEBUG-HELPER:([a-z0-9]+)\]/);
  return match ? match[1] : null;
}

export function isStartMarker(line: string): boolean {
  return /\[DEBUG-HELPER:[a-z0-9]+\] START/.test(line);
}

export function isEndMarker(line: string): boolean {
  return /\[DEBUG-HELPER:[a-z0-9]+\] END/.test(line);
}

export function findInstrumentationBlocks(
  content: string,
  _filePath: string
): Array<{ markerId: string; startLine: number; endLine: number; content: string }> {
  const lines = content.split("\n");
  const blocks: Array<{ markerId: string; startLine: number; endLine: number; content: string }> = [];
  
  let currentBlock: { markerId: string; startLine: number; lines: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (isStartMarker(line)) {
      const markerId = extractMarkerId(line);
      if (markerId) {
        currentBlock = { markerId, startLine: i + 1, lines: [line] };
      }
    } else if (isEndMarker(line) && currentBlock) {
      const markerId = extractMarkerId(line);
      if (markerId === currentBlock.markerId) {
        currentBlock.lines.push(line);
        blocks.push({
          markerId: currentBlock.markerId,
          startLine: currentBlock.startLine,
          endLine: i + 1,
          content: currentBlock.lines.join("\n"),
        });
        currentBlock = null;
      }
    } else if (currentBlock) {
      currentBlock.lines.push(line);
    }
  }

  return blocks;
}

export function removeAllInstrumentationBlocks(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inBlock = false;

  for (const line of lines) {
    if (isStartMarker(line)) {
      inBlock = true;
      continue;
    }
    if (isEndMarker(line)) {
      inBlock = false;
      continue;
    }
    if (!inBlock) {
      result.push(line);
    }
  }

  return result.join("\n");
}

export function removeInstrumentationBlock(content: string, markerId: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inTargetBlock = false;

  for (const line of lines) {
    const lineMarkerId = extractMarkerId(line);
    
    if (isStartMarker(line) && lineMarkerId === markerId) {
      inTargetBlock = true;
      continue;
    }
    if (isEndMarker(line) && lineMarkerId === markerId) {
      inTargetBlock = false;
      continue;
    }
    if (!inTargetBlock) {
      result.push(line);
    }
  }

  return result.join("\n");
}
