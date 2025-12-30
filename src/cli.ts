#!/usr/bin/env node

import { saveGlobalConfig } from "./config.js";
import { createInterface } from "node:readline";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PLUGIN_NAME = "opencode-debug-helper";

const MODELS = [
  { value: "google/gemini-3-flash", label: "Google Gemini 3 Flash (fast, recommended)" },
  { value: "google/gemini-3-flash-lite", label: "Google Gemini 3 Flash Lite (fastest)" },
  { value: "anthropic/claude-3-haiku", label: "Anthropic Claude 3 Haiku" },
  { value: "openai/gpt-4o-mini", label: "OpenAI GPT-4o Mini" },
];

async function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function getOpencodeConfigPath(): string {
  const paths = [
    join(homedir(), ".config", "opencode", "opencode.jsonc"),
    join(homedir(), ".config", "opencode", "opencode.json"),
  ];

  for (const p of paths) {
    if (existsSync(p)) return p;
  }

  return paths[0];
}

function parseJsonc(content: string): Record<string, unknown> {
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  return JSON.parse(stripped);
}

async function ensurePluginInConfig(): Promise<{ added: boolean; path: string }> {
  const configPath = getOpencodeConfigPath();
  const configDir = join(homedir(), ".config", "opencode");

  await mkdir(configDir, { recursive: true });

  let config: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    const content = await readFile(configPath, "utf-8");
    try {
      config = parseJsonc(content);
    } catch {
      console.error(`Warning: Could not parse ${configPath}`);
      return { added: false, path: configPath };
    }
  }

  const plugins = (config.plugin as string[]) || [];
  const hasPlugin = plugins.some(
    (p) => p === PLUGIN_NAME || p.startsWith(`${PLUGIN_NAME}@`)
  );

  if (hasPlugin) {
    return { added: false, path: configPath };
  }

  config.plugin = [...plugins, `${PLUGIN_NAME}@latest`];
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");

  return { added: true, path: configPath };
}

async function setup() {
  console.log("\nOpenCode Debug Helper - Setup\n");

  console.log("Step 1: Configuring opencode.jsonc...\n");
  const { added, path } = await ensurePluginInConfig();
  if (added) {
    console.log(`   Added plugin to ${path}\n`);
  } else {
    console.log(`   Plugin already configured in ${path}\n`);
  }

  console.log("Step 2: Select model for analyzer/RCA sub-agents:\n");
  MODELS.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.label}`);
  });
  console.log(`  ${MODELS.length + 1}. Custom (enter model string)`);
  console.log();

  const choice = await prompt(`Choice [1-${MODELS.length + 1}]: `);
  const choiceNum = parseInt(choice, 10);

  let selectedModel: string;

  if (choiceNum >= 1 && choiceNum <= MODELS.length) {
    selectedModel = MODELS[choiceNum - 1].value;
  } else if (choiceNum === MODELS.length + 1) {
    selectedModel = await prompt("Enter model string (e.g., provider/model): ");
    if (!selectedModel.includes("/")) {
      console.error("Invalid model format. Expected: provider/model");
      process.exit(1);
    }
  } else {
    console.log("Invalid choice, using default: google/gemini-3-flash");
    selectedModel = "google/gemini-3-flash";
  }

  await saveGlobalConfig({
    models: {
      analyzer: selectedModel,
      rca: selectedModel,
    },
  });

  console.log(`\nSetup complete!`);
  console.log(`   Model: ${selectedModel}`);
  console.log(`   Plugin config: ~/.config/opencode/debug-helper.json`);
  console.log(`\n   Restart opencode to use the plugin.`);
  console.log(`   Then use /debug to start debugging.\n`);
}

function showHelp() {
  console.log(`
opencode-debug-helper - Cursor-style debug mode for OpenCode

Commands:
  setup    Configure the plugin (adds to opencode.jsonc + model selection)
  help     Show this help message

Tools provided:
  project_detector  - Detects project type, framework, and run commands
  instrumentation   - Add/remove debug logging markers (coming soon)
  log_parser        - Parse logs for errors and debug markers (coming soon)

Agents provided:
  debug-helper              - Primary orchestrator for debugging workflow
  debug-helper:project-analyzer - Analyzes project structure
  debug-helper:rca          - Root cause analysis specialist

Commands:
  /debug   - Start the debugging workflow

Learn more: https://github.com/shamashel/opencode-debug-helper
`);
}

const command = process.argv[2];

switch (command) {
  case "setup":
    setup().catch(console.error);
    break;
  case "help":
  case "--help":
  case "-h":
  default:
    showHelp();
    break;
}
