import { describe, it, expect } from "vitest";
import {
  getPatternForFile,
  buildInstrumentationBlock,
  extractMarkerId,
  isStartMarker,
  isEndMarker,
  findInstrumentationBlocks,
  removeInstrumentationBlock,
  removeAllInstrumentationBlocks,
} from "./instrumentation-patterns.js";

describe("getPatternForFile", () => {
  it("returns JS pattern for .js files", () => {
    const pattern = getPatternForFile("/path/to/file.js");
    expect(pattern).not.toBeNull();
    expect(pattern?.extensions).toContain(".js");
  });

  it("returns TS pattern for .ts files", () => {
    const pattern = getPatternForFile("/path/to/file.ts");
    expect(pattern).not.toBeNull();
    expect(pattern?.extensions).toContain(".ts");
  });

  it("returns Python pattern for .py files", () => {
    const pattern = getPatternForFile("/path/to/file.py");
    expect(pattern).not.toBeNull();
    expect(pattern?.extensions).toContain(".py");
  });

  it("returns Rust pattern for .rs files", () => {
    const pattern = getPatternForFile("/path/to/file.rs");
    expect(pattern).not.toBeNull();
    expect(pattern?.extensions).toContain(".rs");
  });

  it("returns Go pattern for .go files", () => {
    const pattern = getPatternForFile("/path/to/file.go");
    expect(pattern).not.toBeNull();
    expect(pattern?.extensions).toContain(".go");
  });

  it("returns null for unsupported extensions", () => {
    expect(getPatternForFile("/path/to/file.java")).toBeNull();
    expect(getPatternForFile("/path/to/file.cpp")).toBeNull();
  });
});

describe("buildInstrumentationBlock", () => {
  it("builds JS block with expression", () => {
    const pattern = getPatternForFile("test.js")!;
    const block = buildInstrumentationBlock(pattern, "abc123", "test label", "myVar");

    expect(block).toContain("// [DEBUG-HELPER:abc123] START");
    expect(block).toContain('console.log("[abc123] test label:", myVar);');
    expect(block).toContain("// [DEBUG-HELPER:abc123] END");
  });

  it("builds JS block without expression", () => {
    const pattern = getPatternForFile("test.js")!;
    const block = buildInstrumentationBlock(pattern, "abc123", "checkpoint");

    expect(block).toContain("// [DEBUG-HELPER:abc123] START");
    expect(block).toContain('console.log("[abc123] checkpoint');
    expect(block).toContain("// [DEBUG-HELPER:abc123] END");
  });

  it("builds Python block with expression", () => {
    const pattern = getPatternForFile("test.py")!;
    const block = buildInstrumentationBlock(pattern, "xyz789", "data", "request_data");

    expect(block).toContain("# [DEBUG-HELPER:xyz789] START");
    expect(block).toContain('print(f"[xyz789] data: {request_data}")');
    expect(block).toContain("# [DEBUG-HELPER:xyz789] END");
  });

  it("respects indentation", () => {
    const pattern = getPatternForFile("test.js")!;
    const block = buildInstrumentationBlock(pattern, "abc123", "test", "x", "    ");

    const lines = block.split("\n");
    expect(lines[0]).toMatch(/^    \/\/ \[DEBUG-HELPER/);
    expect(lines[1]).toMatch(/^    console\.log/);
    expect(lines[2]).toMatch(/^    \/\/ \[DEBUG-HELPER/);
  });
});

describe("marker detection", () => {
  it("extracts marker ID from line", () => {
    expect(extractMarkerId("// [DEBUG-HELPER:abc123] START")).toBe("abc123");
    expect(extractMarkerId("# [DEBUG-HELPER:xyz789] END")).toBe("xyz789");
    expect(extractMarkerId('console.log("[abc123] test");')).toBeNull();
  });

  it("detects start markers", () => {
    expect(isStartMarker("// [DEBUG-HELPER:abc123] START")).toBe(true);
    expect(isStartMarker("# [DEBUG-HELPER:abc123] START")).toBe(true);
    expect(isStartMarker("// [DEBUG-HELPER:abc123] END")).toBe(false);
    expect(isStartMarker("console.log('test')")).toBe(false);
  });

  it("detects end markers", () => {
    expect(isEndMarker("// [DEBUG-HELPER:abc123] END")).toBe(true);
    expect(isEndMarker("# [DEBUG-HELPER:abc123] END")).toBe(true);
    expect(isEndMarker("// [DEBUG-HELPER:abc123] START")).toBe(false);
  });
});

describe("findInstrumentationBlocks", () => {
  it("finds single block", () => {
    const content = `function test() {
// [DEBUG-HELPER:abc123] START
console.log("[abc123] test:", x);
// [DEBUG-HELPER:abc123] END
  return x;
}`;

    const blocks = findInstrumentationBlocks(content, "test.js");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].markerId).toBe("abc123");
    expect(blocks[0].startLine).toBe(2);
    expect(blocks[0].endLine).toBe(4);
  });

  it("finds multiple blocks", () => {
    const content = `// [DEBUG-HELPER:aaa111] START
console.log("[aaa111] first");
// [DEBUG-HELPER:aaa111] END
some code
// [DEBUG-HELPER:bbb222] START
console.log("[bbb222] second");
// [DEBUG-HELPER:bbb222] END`;

    const blocks = findInstrumentationBlocks(content, "test.js");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].markerId).toBe("aaa111");
    expect(blocks[1].markerId).toBe("bbb222");
  });

  it("returns empty for no blocks", () => {
    const content = "const x = 1;\nconsole.log(x);";
    const blocks = findInstrumentationBlocks(content, "test.js");
    expect(blocks).toHaveLength(0);
  });
});

describe("removeInstrumentationBlock", () => {
  it("removes specific block by ID", () => {
    const content = `line1
// [DEBUG-HELPER:abc123] START
console.log("[abc123] test");
// [DEBUG-HELPER:abc123] END
line2`;

    const result = removeInstrumentationBlock(content, "abc123");
    expect(result).toBe("line1\nline2");
  });

  it("leaves other blocks intact", () => {
    const content = `// [DEBUG-HELPER:keep] START
console.log("[keep] keep this");
// [DEBUG-HELPER:keep] END
// [DEBUG-HELPER:remove] START
console.log("[remove] remove this");
// [DEBUG-HELPER:remove] END`;

    const result = removeInstrumentationBlock(content, "remove");
    expect(result).toContain("[DEBUG-HELPER:keep]");
    expect(result).not.toContain("[DEBUG-HELPER:remove]");
  });
});

describe("removeAllInstrumentationBlocks", () => {
  it("removes all blocks", () => {
    const content = `line1
// [DEBUG-HELPER:aaa] START
console.log("[aaa] first");
// [DEBUG-HELPER:aaa] END
line2
// [DEBUG-HELPER:bbb] START
console.log("[bbb] second");
// [DEBUG-HELPER:bbb] END
line3`;

    const result = removeAllInstrumentationBlocks(content);
    expect(result).toBe("line1\nline2\nline3");
    expect(result).not.toContain("DEBUG-HELPER");
  });
});
