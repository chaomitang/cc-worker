import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type RunResult = {
  sessionId: string;
  text: string;
  costUsd?: number;
  success: boolean;
  error?: string;
  messages: SDKMessage[];
};
