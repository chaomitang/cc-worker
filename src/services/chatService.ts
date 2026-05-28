import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionStore } from "../session/SessionStore.js";
import type { Channel } from "../session/SessionStore.js";
import { chatHistoryStore } from "../storage/chatHistoryStore.js";
import { usageStore } from "../storage/usageStore.js";
import { extractTokensFromResult, type TokenTotals } from "../storage/tokenUsage.js";
import type { PendingPermission } from "./permissionBroker.js";

export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | {
      type: "done";
      sessionId: string;
      text: string;
      tokens: TokenTotals;
      usageTotals: TokenTotals;
      numTurns?: number;
    }
  | { type: "error"; message: string };

export async function prepareChatSession(
  store: SessionStore,
  channel: Channel,
  peerId: string,
): Promise<void> {
  const chat = await chatHistoryStore.getSession(channel, peerId);
  if (chat.claudeSessionId) {
    store.setResumeSessionId(channel, peerId, chat.claudeSessionId);
  }
}

export async function* streamChat(
  store: SessionStore,
  channel: Channel,
  peerId: string,
  prompt: string,
  onPermission?: (request: PendingPermission) => void,
): AsyncGenerator<ChatStreamEvent> {
  await prepareChatSession(store, channel, peerId);

  await chatHistoryStore.appendMessage(channel, peerId, {
    role: "user",
    content: prompt,
  });

  const agent = store.getAgent(channel, peerId);
  agent.setPermissionPendingHandler((request) => {
    onPermission?.(request);
  });

  let text = "";
  let sessionId = "";

  try {
    for await (const message of agent.runStream(prompt)) {
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
        store.touch(channel, peerId, sessionId);
        await chatHistoryStore.setClaudeSessionId(channel, peerId, sessionId);
        store.setResumeSessionId(channel, peerId, sessionId);
      }
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text) {
            text += block.text;
            yield { type: "text", delta: block.text };
          }
        }
      }

      if (message.type === "result") {
        const result = message as SDKResultMessage;
        sessionId = result.session_id;
        store.touch(channel, peerId, sessionId);
        await chatHistoryStore.setClaudeSessionId(channel, peerId, sessionId);
        store.setResumeSessionId(channel, peerId, sessionId);

        if (result.subtype === "success") {
          const tokens = extractTokensFromResult(result);
          const ledger = await usageStore.recordQuery(channel, peerId, {
            promptPreview: prompt,
            tokens,
            numTurns: result.num_turns,
          });

          await chatHistoryStore.appendMessage(channel, peerId, {
            role: "assistant",
            content: result.result,
            tokens,
            numTurns: result.num_turns,
          });

          yield {
            type: "done",
            sessionId,
            text: result.result,
            tokens,
            usageTotals: ledger.totals,
            numTurns: result.num_turns,
          };
        } else {
          yield {
            type: "error",
            message: result.errors?.join("\n") ?? result.subtype,
          };
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: "error", message };
  }
}

export async function runChat(
  store: SessionStore,
  channel: Channel,
  peerId: string,
  prompt: string,
): Promise<{ text: string; sessionId: string; messages: SDKMessage[] }> {
  const agent = store.getAgent(channel, peerId);
  const result = await agent.run(prompt);
  if (!result.success) {
    throw new Error(result.error ?? "Agent run failed");
  }
  return {
    text: result.text,
    sessionId: result.sessionId,
    messages: result.messages,
  };
}
