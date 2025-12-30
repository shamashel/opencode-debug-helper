import type { Plugin } from "@opencode-ai/plugin";
import { projectDetectorTool } from "./tools/project-detector.js";
import {
  addInstrumentationTool,
  removeInstrumentationTool,
  listInstrumentationTool,
  removeAllInstrumentationTool,
  scanFileInstrumentationTool,
} from "./tools/instrumentation.js";
import {
  parseLogsTool,
  extractDebugValuesTool,
  correlateLogsWithMarkersTool,
} from "./tools/log-parser.js";
import {
  startProcessTool,
  stopProcessTool,
  captureOutputTool,
  listProcessesTool,
} from "./tools/process-runner.js";
import { loadConfig } from "./config.js";
import {
  debugHelperAgent,
  createProjectAnalyzerAgent,
  createRcaAgent,
} from "./agents/index.js";

export const DebugHelperPlugin: Plugin = async ({ directory }) => {
  return {
    tool: {
      project_detector: projectDetectorTool,
      add_instrumentation: addInstrumentationTool,
      remove_instrumentation: removeInstrumentationTool,
      list_instrumentation: listInstrumentationTool,
      remove_all_instrumentation: removeAllInstrumentationTool,
      scan_file_instrumentation: scanFileInstrumentationTool,
      parse_logs: parseLogsTool,
      extract_debug_values: extractDebugValuesTool,
      correlate_logs: correlateLogsWithMarkersTool,
      start_process: startProcessTool,
      stop_process: stopProcessTool,
      capture_output: captureOutputTool,
      list_processes: listProcessesTool,
    },

    config: async (openCodeConfig) => {
      const pluginConfig = await loadConfig(directory);
      const analyzerModel = pluginConfig.models?.analyzer ?? "google/gemini-3-flash";
      const rcaModel = pluginConfig.models?.rca ?? "google/gemini-3-flash";

      openCodeConfig.agent = {
        ...openCodeConfig.agent,
        "debug-helper": debugHelperAgent,
        "debug-helper:project-analyzer": createProjectAnalyzerAgent(analyzerModel),
        "debug-helper:rca": createRcaAgent(rcaModel),
      };

      openCodeConfig.command = {
        ...openCodeConfig.command,
        debug: {
          template:
            "Start debug mode: detect project configuration, prepare for instrumentation-based debugging workflow.",
          description: "Cursor-style debug mode for systematic bug investigation",
          agent: "debug-helper",
        },
      };
    },
  };
};

export default DebugHelperPlugin;
