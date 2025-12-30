import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import {
  type ProjectInfo,
  type PackageJson,
  type PyProjectToml,
  type CargoToml,
  type DockerCompose,
  type VSCodeLaunch,
  FRAMEWORK_PATTERNS,
  SERVER_INDICATORS,
} from "../utils/project-types.js";

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    if (!existsSync(path)) return null;
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function readTomlFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    if (!existsSync(path)) return null;
    const content = await readFile(path, "utf-8");
    // Simple TOML parser for common cases
    return parseSimpleToml(content);
  } catch {
    return null;
  }
}

function parseSimpleToml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection = result;
  let currentPath: string[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Section header [section] or [section.subsection]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentPath = sectionMatch[1].split(".");
      currentSection = result;
      for (const part of currentPath) {
        if (!(part in currentSection)) {
          (currentSection as Record<string, unknown>)[part] = {};
        }
        currentSection = (currentSection as Record<string, unknown>)[part] as Record<string, unknown>;
      }
      continue;
    }

    // Key = value
    const kvMatch = trimmed.match(/^([^=]+)=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let value: unknown = kvMatch[2].trim();
      
      // Parse value
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10);
      else if ((value as string).startsWith('"') && (value as string).endsWith('"')) {
        value = (value as string).slice(1, -1);
      } else if ((value as string).startsWith("'") && (value as string).endsWith("'")) {
        value = (value as string).slice(1, -1);
      } else if ((value as string).startsWith("[")) {
        // Simple array parsing
        const arrayContent = (value as string).slice(1, -1);
        value = arrayContent.split(",").map(v => {
          v = v.trim();
          if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
          if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
          return v;
        }).filter(Boolean);
      }
      
      (currentSection as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}

async function readYamlFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    if (!existsSync(path)) return null;
    const content = await readFile(path, "utf-8");
    // Simple YAML parser for docker-compose files
    return parseSimpleYaml(content);
  } catch {
    return null;
  }
}

function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split("\n");
  const stack: Array<{ indent: number; obj: Record<string, unknown> }> = [{ indent: -1, obj: result }];

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    
    const indent = line.search(/\S/);
    const trimmed = line.trim();
    
    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    
    const parent = stack[stack.length - 1].obj;
    
    // Key: value or Key:
    const match = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      
      if (value) {
        // Has inline value
        parent[key] = value.replace(/^["']|["']$/g, "");
      } else {
        // Object or array follows
        parent[key] = {};
        stack.push({ indent, obj: parent[key] as Record<string, unknown> });
      }
    } else if (trimmed.startsWith("- ")) {
      // Array item
      const parentKey = Object.keys(parent).pop();
      if (parentKey) {
        if (!Array.isArray(parent[parentKey])) {
          parent[parentKey] = [];
        }
        (parent[parentKey] as unknown[]).push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ""));
      }
    }
  }

  return result;
}

function detectFramework(deps: Record<string, string>): string | undefined {
  for (const [, config] of Object.entries(FRAMEWORK_PATTERNS)) {
    if (config.deps.some(dep => dep in deps)) {
      return config.framework;
    }
  }
  return undefined;
}

function inferRuntime(scripts: Record<string, string>, workspaces?: string[]): ProjectInfo["runtime"] {
  if (workspaces && workspaces.length > 0) {
    return "monorepo";
  }
  
  const scriptValues = Object.values(scripts).join(" ").toLowerCase();
  const scriptKeys = Object.keys(scripts).join(" ").toLowerCase();
  
  if (SERVER_INDICATORS.some(ind => scriptValues.includes(ind) || scriptKeys.includes(ind))) {
    return "server";
  }
  
  if (scripts.test || scripts.jest || scripts.mocha) {
    return "test";
  }
  
  return "cli";
}

function getPackageManager(packageJson: PackageJson, cwd: string): ProjectInfo["package_manager"] {
  // Check packageManager field
  if (packageJson.packageManager) {
    if (packageJson.packageManager.startsWith("yarn")) return "yarn";
    if (packageJson.packageManager.startsWith("pnpm")) return "pnpm";
    if (packageJson.packageManager.startsWith("npm")) return "npm";
  }
  
  // Check lock files
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  
  return "npm";
}

function getWorkspaces(packageJson: PackageJson): string[] | undefined {
  if (!packageJson.workspaces) return undefined;
  if (Array.isArray(packageJson.workspaces)) return packageJson.workspaces;
  if (packageJson.workspaces.packages) return packageJson.workspaces.packages;
  return undefined;
}

async function detectNode(cwd: string): Promise<ProjectInfo | null> {
  const packageJson = await readJsonFile<PackageJson>(join(cwd, "package.json"));
  if (!packageJson) return null;

  const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const scripts = packageJson.scripts || {};
  const workspaces = getWorkspaces(packageJson);
  const packageManager = getPackageManager(packageJson, cwd);

  const prefix = packageManager === "yarn" ? "yarn" : packageManager === "pnpm" ? "pnpm" : "npm run";

  const info: ProjectInfo = {
    type: "node",
    package_manager: packageManager,
    framework: detectFramework(allDeps),
    runtime: inferRuntime(scripts, workspaces),
    commands: {},
    workspaces,
  };

  // Map common scripts
  if (scripts.dev) info.commands.dev = `${prefix} dev`;
  else if (scripts["start:dev"]) info.commands.dev = `${prefix} start:dev`;
  else if (scripts.develop) info.commands.dev = `${prefix} develop`;

  if (scripts.build) info.commands.build = `${prefix} build`;
  if (scripts.start) info.commands.start = `${prefix} start`;
  if (scripts.test) info.commands.test = `${prefix} test`;
  if (scripts.lint) info.commands.lint = `${prefix} lint`;

  // Check for env files
  const envFiles: string[] = [];
  for (const envFile of [".env", ".env.local", ".env.development"]) {
    if (existsSync(join(cwd, envFile))) envFiles.push(envFile);
  }
  if (envFiles.length > 0) info.env_files = envFiles;

  return info;
}

async function detectPython(cwd: string): Promise<ProjectInfo | null> {
  const pyproject = await readTomlFile(join(cwd, "pyproject.toml")) as PyProjectToml | null;
  
  // Check for Python project markers
  const hasPyproject = pyproject !== null;
  const hasRequirements = existsSync(join(cwd, "requirements.txt"));
  const hasSetupPy = existsSync(join(cwd, "setup.py"));
  
  if (!hasPyproject && !hasRequirements && !hasSetupPy) return null;

  const info: ProjectInfo = {
    type: "python",
    runtime: "cli",
    commands: {},
  };

  // Detect package manager
  if (existsSync(join(cwd, "uv.lock")) || pyproject?.tool?.uv) {
    info.package_manager = "uv";
  } else if (existsSync(join(cwd, "poetry.lock"))) {
    info.package_manager = "pip"; // poetry uses pip under the hood
  } else {
    info.package_manager = "pip";
  }

  const prefix = info.package_manager === "uv" ? "uv run" : "python -m";

  // Check for workspaces (uv)
  if (pyproject?.tool?.uv?.workspace?.members) {
    info.workspaces = pyproject.tool.uv.workspace.members;
    info.runtime = "monorepo";
  }

  // Infer commands from project scripts
  if (pyproject?.project?.scripts) {
    const scripts = pyproject.project.scripts;
    for (const [name] of Object.entries(scripts)) {
      if (name.includes("serve") || name.includes("run") || name.includes("start")) {
        info.commands.start = `${prefix} ${name}`;
        info.runtime = "server";
      }
    }
  }

  // Common Python commands
  info.commands.test = `${prefix} pytest`;
  info.commands.lint = `${prefix} ruff check .`;

  // Check for common Python server frameworks
  if (hasPyproject) {
    const content = await readFile(join(cwd, "pyproject.toml"), "utf-8");
    if (content.includes("fastapi")) {
      info.framework = "FastAPI";
      info.runtime = "server";
      info.commands.dev = `${prefix} uvicorn main:app --reload`;
    } else if (content.includes("flask")) {
      info.framework = "Flask";
      info.runtime = "server";
      info.commands.dev = `${prefix} flask run --debug`;
    } else if (content.includes("django")) {
      info.framework = "Django";
      info.runtime = "server";
      info.commands.dev = `${prefix} manage.py runserver`;
    }
  }

  return info;
}

async function detectRust(cwd: string): Promise<ProjectInfo | null> {
  const cargoToml = await readTomlFile(join(cwd, "Cargo.toml")) as CargoToml | null;
  if (!cargoToml) return null;

  const info: ProjectInfo = {
    type: "rust",
    package_manager: "cargo",
    runtime: "cli",
    commands: {
      build: "cargo build",
      test: "cargo test",
      lint: "cargo clippy",
    },
  };

  // Check for workspace
  if (cargoToml.workspace?.members) {
    info.workspaces = cargoToml.workspace.members;
    info.runtime = "monorepo";
  }

  // Check for binary targets
  if (cargoToml.bin && cargoToml.bin.length > 0) {
    info.commands.start = `cargo run --bin ${cargoToml.bin[0].name}`;
  } else if (cargoToml.package?.name) {
    info.commands.start = "cargo run";
  }

  info.commands.dev = "cargo watch -x run";

  return info;
}

async function detectGo(cwd: string): Promise<ProjectInfo | null> {
  if (!existsSync(join(cwd, "go.mod"))) return null;

  const info: ProjectInfo = {
    type: "go",
    runtime: "cli",
    commands: {
      build: "go build ./...",
      test: "go test ./...",
      lint: "golangci-lint run",
      start: "go run .",
      dev: "go run .",
    },
  };

  // Check for main.go to determine if it's an executable
  if (existsSync(join(cwd, "main.go")) || existsSync(join(cwd, "cmd"))) {
    info.runtime = "cli";
  }

  return info;
}

async function detectDocker(cwd: string): Promise<ProjectInfo["docker"] | undefined> {
  const composeFiles = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
  ];

  for (const file of composeFiles) {
    const compose = await readYamlFile(join(cwd, file)) as DockerCompose | null;
    if (compose?.services) {
      return {
        compose_file: file,
        services: Object.keys(compose.services),
      };
    }
  }

  return undefined;
}

async function detectVSCodeLaunch(cwd: string): Promise<Partial<ProjectInfo["commands"]>> {
  const launch = await readJsonFile<VSCodeLaunch>(join(cwd, ".vscode", "launch.json"));
  if (!launch?.configurations) return {};

  const commands: Partial<ProjectInfo["commands"]> = {};

  for (const config of launch.configurations) {
    if (config.name.toLowerCase().includes("debug") && config.program) {
      // Could extract command from launch config
    }
  }

  return commands;
}

export const projectDetectorTool: ToolDefinition = tool({
  description: `Detect project type, package manager, framework, and run commands by analyzing project files.
Analyzes: package.json, pyproject.toml, Cargo.toml, go.mod, docker-compose.yml, .vscode/launch.json.
Returns structured ProjectInfo with detected commands for dev, build, start, test.`,
  args: {
    cwd: tool.schema
      .string()
      .optional()
      .describe("Directory to analyze. Defaults to current working directory."),
  },
  async execute(args) {
    const cwd = args.cwd || process.cwd();

    // Try each detector
    const nodeInfo = await detectNode(cwd);
    const pythonInfo = await detectPython(cwd);
    const rustInfo = await detectRust(cwd);
    const goInfo = await detectGo(cwd);

    // Determine primary project type
    let info: ProjectInfo;

    if (nodeInfo && pythonInfo) {
      // Polyglot project
      info = {
        type: "polyglot",
        runtime: nodeInfo.runtime === "monorepo" || pythonInfo.runtime === "monorepo" ? "monorepo" : "server",
        commands: { ...pythonInfo.commands, ...nodeInfo.commands },
        package_manager: nodeInfo.package_manager,
        framework: nodeInfo.framework || pythonInfo.framework,
        workspaces: nodeInfo.workspaces || pythonInfo.workspaces,
      };
    } else if (nodeInfo) {
      info = nodeInfo;
    } else if (pythonInfo) {
      info = pythonInfo;
    } else if (rustInfo) {
      info = rustInfo;
    } else if (goInfo) {
      info = goInfo;
    } else {
      info = {
        type: "unknown",
        runtime: "cli",
        commands: {},
      };
    }

    // Add Docker info if present
    const docker = await detectDocker(cwd);
    if (docker) {
      info.docker = docker;
    }

    // Check VS Code launch config for additional commands
    const vsCodeCommands = await detectVSCodeLaunch(cwd);
    info.commands = { ...info.commands, ...vsCodeCommands };

    // Format output
    let output = `## Project Detection Results\n\n`;
    output += `| Property | Value |\n`;
    output += `|----------|-------|\n`;
    output += `| Type | ${info.type} |\n`;
    output += `| Runtime | ${info.runtime} |\n`;
    if (info.package_manager) output += `| Package Manager | ${info.package_manager} |\n`;
    if (info.framework) output += `| Framework | ${info.framework} |\n`;

    output += `\n### Commands\n\n`;
    output += `| Command | Value |\n`;
    output += `|---------|-------|\n`;
    for (const [cmd, value] of Object.entries(info.commands)) {
      if (value) output += `| ${cmd} | \`${value}\` |\n`;
    }

    if (info.workspaces && info.workspaces.length > 0) {
      output += `\n### Workspaces\n\n`;
      for (const ws of info.workspaces) {
        output += `- ${ws}\n`;
      }
    }

    if (info.docker) {
      output += `\n### Docker\n\n`;
      output += `- Compose file: ${info.docker.compose_file}\n`;
      output += `- Services: ${info.docker.services.join(", ")}\n`;
    }

    if (info.env_files && info.env_files.length > 0) {
      output += `\n### Environment Files\n\n`;
      for (const env of info.env_files) {
        output += `- ${env}\n`;
      }
    }

    output += `\n### Raw JSON\n\n\`\`\`json\n${JSON.stringify(info, null, 2)}\n\`\`\``;

    return output;
  },
});
