import { describe, it, expect } from "vitest";
import {
  parseLogContent,
  filterDebugHelperOutput,
  filterErrors,
  groupByMarker,
  extractDebugValue,
  summarizeLogAnalysis,
} from "./log-patterns.js";

describe("parseLogContent", () => {
  it("detects DEBUG-HELPER markers", () => {
    const content = `Starting app...
[DEBUG-HELPER:abc123] before fetch: {userId: 1}
Fetching data...
[DEBUG-HELPER:abc123] after fetch: {data: "test"}`;

    const matches = parseLogContent(content);
    const debugMatches = matches.filter((m) => m.type === "debug-helper");

    expect(debugMatches).toHaveLength(2);
    expect(debugMatches[0].marker_id).toBe("abc123");
    expect(debugMatches[0].line).toBe(2);
  });

  it("detects JavaScript errors", () => {
    const content = `TypeError: Cannot read property 'foo' of undefined
    at Object.<anonymous> (/app/index.js:10:5)
    at Module._compile (node:internal/modules/cjs/loader:1254:14)`;

    const matches = parseLogContent(content);
    const errors = matches.filter((m) => m.type === "error");

    // Multiple lines may match error patterns (TypeError + stack frames)
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].content).toContain("TypeError");
  });

  it("detects Python errors", () => {
    const content = `Traceback (most recent call last):
  File "app.py", line 10, in <module>
    raise ValueError("invalid input")
ValueError: invalid input`;

    const matches = parseLogContent(content);
    const errors = matches.filter((m) => m.type === "error");

    expect(errors.length).toBeGreaterThan(0);
  });

  it("detects warnings", () => {
    const content = `[WARN] Deprecated API used
[WARNING] This feature is experimental`;

    const matches = parseLogContent(content);
    const warnings = matches.filter((m) => m.type === "warning");

    expect(warnings).toHaveLength(2);
  });

  it("detects HTTP errors", () => {
    const content = `GET /api/users 500 Internal Server Error
POST /login 401 Unauthorized`;

    const matches = parseLogContent(content);
    const errors = matches.filter((m) => m.type === "error");

    expect(errors).toHaveLength(2);
  });

  it("detects connection errors", () => {
    const content = `Error: connect ECONNREFUSED 127.0.0.1:5432
Error: Connection timeout after 30000ms`;

    const matches = parseLogContent(content);
    const errors = matches.filter((m) => m.type === "error");

    expect(errors).toHaveLength(2);
  });
});

describe("filterDebugHelperOutput", () => {
  it("returns only debug-helper matches", () => {
    const matches = parseLogContent(`Error: something broke
[DEBUG-HELPER:abc] test: value
Warning: deprecated`);

    const filtered = filterDebugHelperOutput(matches);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe("debug-helper");
  });
});

describe("filterErrors", () => {
  it("returns only error matches", () => {
    const matches = parseLogContent(`Error: something broke
[DEBUG-HELPER:abc] test: value
Warning: deprecated`);

    const filtered = filterErrors(matches);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe("error");
  });
});

describe("groupByMarker", () => {
  it("groups matches by marker ID", () => {
    const content = `[DEBUG-HELPER:aaa] first: 1
[DEBUG-HELPER:bbb] second: 2
[DEBUG-HELPER:aaa] first again: 3`;

    const matches = parseLogContent(content);
    const groups = groupByMarker(matches);

    expect(groups.get("aaa")).toHaveLength(2);
    expect(groups.get("bbb")).toHaveLength(1);
  });
});

describe("extractDebugValue", () => {
  it("extracts label and value", () => {
    const result = extractDebugValue("[DEBUG-HELPER:abc123] user data: {id: 1, name: 'test'}");

    expect(result).not.toBeNull();
    expect(result!.markerId).toBe("abc123");
    expect(result!.label).toBe("user data");
    expect(result!.value).toBe("{id: 1, name: 'test'}");
  });

  it("handles simple values", () => {
    const result = extractDebugValue("[DEBUG-HELPER:xyz] count: 42");

    expect(result).not.toBeNull();
    expect(result!.label).toBe("count");
    expect(result!.value).toBe("42");
  });

  it("returns null for non-matching lines", () => {
    expect(extractDebugValue("console.log('test')")).toBeNull();
    expect(extractDebugValue("[abc123] no DEBUG-HELPER prefix")).toBeNull();
  });
});

describe("summarizeLogAnalysis", () => {
  it("provides accurate summary", () => {
    const content = `Error: first error
[DEBUG-HELPER:aaa] marker 1: value
Warning: a warning
[DEBUG-HELPER:bbb] marker 2: value
Error: second error
[DEBUG-HELPER:aaa] marker 1 again: value`;

    const matches = parseLogContent(content);
    const summary = summarizeLogAnalysis(matches);

    expect(summary.total).toBe(6);
    expect(summary.errors).toBe(2);
    expect(summary.warnings).toBe(1);
    expect(summary.debug_markers).toBe(3);
    expect(summary.marker_ids).toContain("aaa");
    expect(summary.marker_ids).toContain("bbb");
    expect(summary.marker_ids).toHaveLength(2);
  });
});
