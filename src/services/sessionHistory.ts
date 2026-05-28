import {
  getSessionMessages,
  listSessions,
  type SDKSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";

export async function listHistorySessions(
  cwd: string,
  limit = 50,
): Promise<SDKSessionInfo[]> {
  return listSessions({ dir: cwd, limit });
}

export async function loadHistoryMessages(
  sessionId: string,
  cwd: string,
  limit = 40,
) {
  return getSessionMessages(sessionId, { dir: cwd, limit });
}
