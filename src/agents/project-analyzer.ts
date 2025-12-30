export const PROJECT_ANALYZER_DESCRIPTION = `Subagent that analyzes project structure and determines how to run it.`;

export const PROJECT_ANALYZER_PROMPT = `You analyze project structure to determine runtime configuration.

## Task
1. Run the \`project_detector\` tool
2. If the detector returns "unknown", use \`read\` and \`glob\` to manually inspect:
   - README.md for run instructions
   - Makefile or justfile for common commands
   - Any shell scripts in bin/ or scripts/
3. Return structured ProjectInfo

## Output Format
Return the detected configuration as structured data:
\`\`\`json
{
  "type": "node|python|rust|go|polyglot|unknown",
  "runtime": "cli|server|test|monorepo",
  "package_manager": "yarn|npm|pnpm|uv|pip|cargo",
  "commands": {
    "dev": "command to start development",
    "build": "command to build",
    "test": "command to run tests"
  }
}
\`\`\``;

export const createProjectAnalyzerAgent = (model: string) => ({
  description: PROJECT_ANALYZER_DESCRIPTION,
  mode: "subagent" as const,
  model,
  color: "#4ECDC4",
  prompt: PROJECT_ANALYZER_PROMPT,
  tools: {
    project_detector: true,
    read: true,
    glob: true,
  },
});
