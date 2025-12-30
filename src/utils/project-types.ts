export interface ProjectInfo {
  type: "node" | "python" | "rust" | "go" | "polyglot" | "unknown";
  package_manager?: "yarn" | "npm" | "pnpm" | "uv" | "pip" | "cargo";
  framework?: string;
  runtime: "cli" | "server" | "test" | "monorepo";
  commands: {
    dev?: string;
    build?: string;
    start?: string;
    test?: string;
    lint?: string;
  };
  workspaces?: string[];
  docker?: {
    compose_file: string;
    services: string[];
  };
  env_files?: string[];
}

export interface PackageJson {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
  packageManager?: string;
}

export interface PyProjectToml {
  project?: {
    name?: string;
    scripts?: Record<string, string>;
  };
  tool?: {
    uv?: {
      workspace?: {
        members?: string[];
      };
    };
    poetry?: {
      scripts?: Record<string, string>;
    };
  };
}

export interface CargoToml {
  package?: {
    name?: string;
  };
  workspace?: {
    members?: string[];
  };
  bin?: Array<{ name: string; path?: string }>;
}

export interface DockerComposeService {
  image?: string;
  build?: string | { context: string; dockerfile?: string };
  command?: string | string[];
  ports?: string[];
  environment?: Record<string, string> | string[];
}

export interface DockerCompose {
  services?: Record<string, DockerComposeService>;
}

export interface VSCodeLaunch {
  version?: string;
  configurations?: Array<{
    name: string;
    type: string;
    request: string;
    program?: string;
    args?: string[];
    cwd?: string;
    runtimeExecutable?: string;
    runtimeArgs?: string[];
  }>;
  compounds?: Array<{
    name: string;
    configurations: string[];
  }>;
}

// Framework detection patterns
export const FRAMEWORK_PATTERNS: Record<string, { deps: string[]; framework: string }> = {
  // Node.js frameworks
  next: { deps: ["next"], framework: "Next.js" },
  express: { deps: ["express"], framework: "Express" },
  fastify: { deps: ["fastify"], framework: "Fastify" },
  nest: { deps: ["@nestjs/core"], framework: "NestJS" },
  react: { deps: ["react", "react-dom"], framework: "React" },
  vue: { deps: ["vue"], framework: "Vue" },
  svelte: { deps: ["svelte"], framework: "Svelte" },
  // Python frameworks
  fastapi: { deps: ["fastapi"], framework: "FastAPI" },
  flask: { deps: ["flask"], framework: "Flask" },
  django: { deps: ["django"], framework: "Django" },
  // Rust frameworks
  actix: { deps: ["actix-web"], framework: "Actix" },
  axum: { deps: ["axum"], framework: "Axum" },
  rocket: { deps: ["rocket"], framework: "Rocket" },
};

// Common server indicators
export const SERVER_INDICATORS = [
  "server",
  "api",
  "backend",
  "web",
  "http",
  "listen",
  "serve",
  "start:dev",
  "dev:server",
];

// Common CLI indicators
export const CLI_INDICATORS = [
  "cli",
  "command",
  "bin",
  "script",
  "tool",
  "run",
];
