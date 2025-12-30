import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { existsSync } from "node:fs";

export interface DebugHelperConfig {
  models: {
    analyzer: string;
    rca: string;
  };
  instrumentation: {
    marker_prefix: string;
  };
  project_detection: {
    custom_commands: Record<string, string>;
  };
}

const DEFAULT_CONFIG: DebugHelperConfig = {
  models: {
    analyzer: "google/gemini-3-flash",
    rca: "google/gemini-3-flash",
  },
  instrumentation: {
    marker_prefix: "DEBUG-HELPER",
  },
  project_detection: {
    custom_commands: {},
  },
};

function getConfigPaths(projectDir?: string): string[] {
  const paths: string[] = [];
  paths.push(join(homedir(), ".config", "opencode", "debug-helper.json"));
  if (projectDir) {
    paths.push(join(projectDir, ".opencode", "debug-helper.json"));
  }
  return paths;
}

export async function loadConfig(projectDir?: string): Promise<DebugHelperConfig> {
  let config = { ...DEFAULT_CONFIG };

  for (const configPath of getConfigPaths(projectDir)) {
    try {
      if (existsSync(configPath)) {
        const content = await readFile(configPath, "utf-8");
        const parsed = JSON.parse(content);
        config = deepMerge(config, parsed);
      }
    } catch {
      // Skip invalid config files
    }
  }

  return config;
}

export async function saveGlobalConfig(config: Partial<DebugHelperConfig>): Promise<void> {
  const configPath = join(homedir(), ".config", "opencode", "debug-helper.json");
  const configDir = dirname(configPath);

  await mkdir(configDir, { recursive: true });

  let existing: Partial<DebugHelperConfig> = {};
  try {
    if (existsSync(configPath)) {
      const content = await readFile(configPath, "utf-8");
      existing = JSON.parse(content);
    }
  } catch {
    // Start fresh
  }

  const merged = deepMerge(existing, config);
  await writeFile(configPath, JSON.stringify(merged, null, 2) + "\n");
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      sourceValue &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key] = sourceValue;
    }
  }

  return result;
}

export function getSessionDir(sessionId: string): string {
  return join(tmpdir(), "opencode-debug-helper", sessionId);
}

export async function ensureSessionDir(sessionId: string): Promise<string> {
  const dir = getSessionDir(sessionId);
  await mkdir(dir, { recursive: true });
  return dir;
}
