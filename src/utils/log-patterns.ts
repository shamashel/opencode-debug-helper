export interface LogMatch {
  type: "error" | "warning" | "info" | "debug" | "debug-helper";
  line: number;
  content: string;
  marker_id?: string;
  details?: string;
}

export const ERROR_PATTERNS: RegExp[] = [
  /\b(error|err|exception|fatal|failed|failure)\b/i,
  /\bstack\s*trace\b/i,
  /\bat\s+[\w.$]+\s*\(.*:\d+:\d+\)/i, // JS: at Module.foo (/path:1:2)
  /\bFile\s+"[^"]+",\s*line\s*\d+/i, // Python: File "x.py", line 1
  /\bpanic:\s*/i, // Go: panic: ...
  /\bthread\s+'[^']+'\s+panicked\s+at/i, // Rust: thread 'main' panicked at
  /\bUnhandledPromiseRejection\b/,
  /\bReferenceError\b/,
  /\bTypeError\b/,
  /\bSyntaxError\b/,
  /\bRangeError\b/,
  /\bErrnoException\b/,
  /\bTraceback\s*\(most\s+recent\s+call\s+last\)/i, // Python traceback header
  /^\s*raise\s+\w+/m,
  /\bAssertionError\b/,
  /\bAttributeError\b/,
  /\bImportError\b/,
  /\bKeyError\b/,
  /\bValueError\b/,
  /\b[45]\d{2}\s+(error|not\s+found|internal\s+server|bad\s+request|unauthorized|forbidden)/i,
  /\bconnection\s+(refused|reset|timeout)/i,
  /\bENOENT\b/,
  /\bECONNREFUSED\b/,
  /\bETIMEDOUT\b/,
];

export const WARNING_PATTERNS: RegExp[] = [
  /\b(warn|warning)\b/i,
  /\bdeprecated\b/i,
  /\bexperimental\b/i,
  /\bunsafe\b/i,
];

export const DEBUG_HELPER_PATTERN = /\[DEBUG-HELPER:([a-z0-9]+)\]/;

export function parseLogContent(content: string): LogMatch[] {
  const lines = content.split("\n");
  const matches: LogMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const markerMatch = line.match(DEBUG_HELPER_PATTERN);
    if (markerMatch) {
      matches.push({
        type: "debug-helper",
        line: lineNum,
        content: line,
        marker_id: markerMatch[1],
      });
      continue;
    }

    let isError = false;
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.test(line)) {
        matches.push({
          type: "error",
          line: lineNum,
          content: line,
          details: extractErrorContext(lines, i),
        });
        isError = true;
        break;
      }
    }
    if (isError) continue;

    for (const pattern of WARNING_PATTERNS) {
      if (pattern.test(line)) {
        matches.push({
          type: "warning",
          line: lineNum,
          content: line,
        });
        break;
      }
    }
  }

  return matches;
}

function extractErrorContext(lines: string[], errorIndex: number): string {
  const contextLines: string[] = [];
  const maxContext = 10;

  for (let i = errorIndex + 1; i < Math.min(lines.length, errorIndex + maxContext); i++) {
    const line = lines[i];
    if (
      /^\s+at\s+/.test(line) || // JS stack frame
      /^\s+File\s+"/.test(line) || // Python traceback frame
      /^\s+\d+:\s+/.test(line) || // Rust backtrace frame
      /^\s+/.test(line)
    ) {
      contextLines.push(line);
    } else {
      break;
    }
  }

  return contextLines.join("\n");
}

export function filterDebugHelperOutput(matches: LogMatch[]): LogMatch[] {
  return matches.filter((m) => m.type === "debug-helper");
}

export function filterErrors(matches: LogMatch[]): LogMatch[] {
  return matches.filter((m) => m.type === "error");
}

export function groupByMarker(matches: LogMatch[]): Map<string, LogMatch[]> {
  const groups = new Map<string, LogMatch[]>();
  
  for (const match of matches) {
    if (match.marker_id) {
      const existing = groups.get(match.marker_id) || [];
      existing.push(match);
      groups.set(match.marker_id, existing);
    }
  }

  return groups;
}

/** Format: [DEBUG-HELPER:abc123] label: value */
export function extractDebugValue(line: string): { markerId: string; label: string; value: string } | null {
  const match = line.match(/\[DEBUG-HELPER:([a-z0-9]+)\]\s*([^:]+):\s*(.+)/);
  if (match) {
    return {
      markerId: match[1],
      label: match[2].trim(),
      value: match[3].trim(),
    };
  }
  return null;
}

export function summarizeLogAnalysis(matches: LogMatch[]): {
  total: number;
  errors: number;
  warnings: number;
  debug_markers: number;
  marker_ids: string[];
} {
  const markerIds = new Set<string>();
  let errors = 0;
  let warnings = 0;
  let debugMarkers = 0;

  for (const match of matches) {
    switch (match.type) {
      case "error":
        errors++;
        break;
      case "warning":
        warnings++;
        break;
      case "debug-helper":
        debugMarkers++;
        if (match.marker_id) markerIds.add(match.marker_id);
        break;
    }
  }

  return {
    total: matches.length,
    errors,
    warnings,
    debug_markers: debugMarkers,
    marker_ids: Array.from(markerIds),
  };
}
