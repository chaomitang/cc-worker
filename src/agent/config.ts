import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { loadPermissionPolicyFromEnv } from "./permissionPolicy.js";

export type CcWorkerConfig = {
  cwd?: string;
  model?: string;
  gatewayUrl?: string;
  apiKey?: string;
  authToken?: string;
  /** Default true: load ~/.claude and project .claude (same as CLI). */
  useClaudeCodeFilesystem?: boolean;
  systemPromptAppend?: string;
  allowedTools?: string[];
  permissionMode?: Options["permissionMode"];
  allowDangerouslySkipPermissions?: boolean;
  interactivePermissions?: boolean;
  resumeSessionId?: string;
  pathToClaudeCodeExecutable?: string;
};

function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export function loadConfigFromEnv(overrides: CcWorkerConfig = {}): CcWorkerConfig {
  const fromEnv: CcWorkerConfig = {
    cwd: process.env.CC_WORKER_CWD ?? process.cwd(),
    model: process.env.ANTHROPIC_MODEL,
    gatewayUrl: process.env.ANTHROPIC_BASE_URL,
    apiKey: process.env.ANTHROPIC_API_KEY,
    authToken: process.env.ANTHROPIC_AUTH_TOKEN,
    useClaudeCodeFilesystem: true,
    pathToClaudeCodeExecutable: process.env.CC_WORKER_CLAUDE_EXECUTABLE,
  };

  const permission = loadPermissionPolicyFromEnv();

  return {
    ...fromEnv,
    ...permission,
    ...pickDefined(overrides),
  };
}

export function buildSdkEnv(config: CcWorkerConfig): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: "cc-worker",
  };

  if (config.gatewayUrl) env.ANTHROPIC_BASE_URL = config.gatewayUrl;
  if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey;
  if (config.authToken) env.ANTHROPIC_AUTH_TOKEN = config.authToken;
  if (config.model) env.ANTHROPIC_MODEL = config.model;

  if (config.gatewayUrl) {
    env.ENABLE_TOOL_SEARCH = process.env.ENABLE_TOOL_SEARCH ?? "true";
  }

  // Third-party gateway: force API key auth, avoid falling back to Claude subscription OAuth.
  if (config.gatewayUrl && config.apiKey) {
    env.DISABLE_LOGIN_COMMAND = process.env.DISABLE_LOGIN_COMMAND ?? "1";
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
  }

  return env;
}
