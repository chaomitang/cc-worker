import {
  query,
  type CanUseTool,
  type Options,
  type SDKMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { buildSdkEnv, loadConfigFromEnv, type CcWorkerConfig } from "./config.js";
import {
  applyPermissionOptions,
  buildCanUseTool,
  loadPermissionPolicyFromEnv,
  type PermissionPolicyConfig,
} from "./permissionPolicy.js";
import type { PermissionBroker } from "../services/permissionBroker.js";
import type { PendingPermission } from "../services/permissionBroker.js";
import type { RunResult } from "./types.js";

export class CcWorkerAgent {
  private sessionId?: string;
  private readonly config: CcWorkerConfig;
  private readonly policy: PermissionPolicyConfig;
  private readonly broker?: PermissionBroker;
  private onPermissionPending?: (pending: PendingPermission) => void;

  constructor(config: CcWorkerConfig = {}, broker?: PermissionBroker) {
    this.config = loadConfigFromEnv(config);
    this.policy = {
      permissionMode: this.config.permissionMode ?? loadPermissionPolicyFromEnv().permissionMode,
      allowDangerouslySkipPermissions:
        this.config.allowDangerouslySkipPermissions ??
        loadPermissionPolicyFromEnv().allowDangerouslySkipPermissions,
      interactivePermissions:
        this.config.interactivePermissions ??
        loadPermissionPolicyFromEnv().interactivePermissions,
    };
    this.broker = broker;
  }

  setPermissionPendingHandler(handler: (pending: PendingPermission) => void): void {
    this.onPermissionPending = handler;
  }

  private buildCanUseTool(): CanUseTool | undefined {
    return buildCanUseTool(this.policy, this.broker, (pending) => {
      this.onPermissionPending?.(pending);
    });
  }

  private buildOptions(extra?: Partial<Options>): Options {
    const useFs = this.config.useClaudeCodeFilesystem !== false;
    const canUseTool = this.buildCanUseTool();

    const options: Options = {
      cwd: this.config.cwd,
      model: this.config.model,
      env: buildSdkEnv(this.config),
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        ...(this.config.systemPromptAppend
          ? { append: this.config.systemPromptAppend }
          : {}),
      },
      tools: { type: "preset", preset: "claude_code" },
      skills: "all",
      ...(useFs ? {} : { settingSources: [] }),
      ...(this.config.allowedTools ? { allowedTools: this.config.allowedTools } : {}),
      ...(this.config.resumeSessionId ? { resume: this.config.resumeSessionId } : {}),
      ...(this.sessionId && !this.config.resumeSessionId
        ? { resume: this.sessionId }
        : {}),
      ...(this.config.pathToClaudeCodeExecutable
        ? { pathToClaudeCodeExecutable: this.config.pathToClaudeCodeExecutable }
        : {}),
      ...extra,
    };

    return applyPermissionOptions(this.policy, options, canUseTool);
  }

  runStream(prompt: string, extraOptions?: Partial<Options>): AsyncGenerator<SDKMessage> {
    const self = this;
    const options = this.buildOptions(extraOptions);

    async function* stream(): AsyncGenerator<SDKMessage> {
      for await (const message of query({ prompt, options })) {
        if (message.type === "system" && message.subtype === "init") {
          self.sessionId = message.session_id;
        }
        yield message;
      }
    }

    return stream();
  }

  async run(prompt: string, extraOptions?: Partial<Options>): Promise<RunResult> {
    const messages: SDKMessage[] = [];
    let text = "";
    let sessionId = "";
    let costUsd: number | undefined;
    let success = false;
    let error: string | undefined;

    for await (const message of this.runStream(prompt, extraOptions)) {
      messages.push(message);

      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") text += block.text;
        }
      }

      if (message.type === "result") {
        const result = message as SDKResultMessage;
        sessionId = result.session_id;
        if (result.subtype === "success") {
          success = true;
          text = result.result;
          costUsd = result.total_cost_usd;
        } else {
          error = result.errors?.join("\n") ?? result.subtype;
        }
      }
    }

    return { sessionId, text, costUsd, success, error, messages };
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }
}

export { type CcWorkerConfig } from "./config.js";
export type { RunResult } from "./types.js";
