import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Channel } from "../session/SessionStore.js";
import { ensureDataDir, getDataDir, safeId } from "./paths.js";
import type { TokenTotals } from "./tokenUsage.js";

export type ChatMessageRole = "user" | "assistant" | "system";

export type StoredChatMessage = {
  id: string;
  role: ChatMessageRole;
  content: string;
  at: number;
  tokens?: TokenTotals;
  numTurns?: number;
};

export type ChatSessionFile = {
  sessionId: string;
  channel: Channel;
  peerId: string;
  createdAt: number;
  updatedAt: number;
  title?: string;
  claudeSessionId?: string;
  messages: StoredChatMessage[];
};

export class ChatHistoryStore {
  private readonly cache = new Map<string, ChatSessionFile>();

  private cacheKey(channel: Channel, peerId: string): string {
    return `${channel}:${peerId}`;
  }

  private filePath(channel: Channel, peerId: string): string {
    return join(getDataDir(), "chats", channel, `${safeId(peerId)}.json`);
  }

  async getSession(channel: Channel, peerId: string): Promise<ChatSessionFile> {
    const key = this.cacheKey(channel, peerId);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const path = this.filePath(channel, peerId);
    try {
      const raw = await readFile(path, "utf8");
      const data = JSON.parse(raw) as ChatSessionFile;
      this.cache.set(key, data);
      return data;
    } catch {
      const now = Date.now();
      const empty: ChatSessionFile = {
        sessionId: peerId,
        channel,
        peerId,
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      this.cache.set(key, empty);
      return empty;
    }
  }

  private async persist(session: ChatSessionFile): Promise<void> {
    await ensureDataDir("chats", session.channel);
    const path = this.filePath(session.channel, session.peerId);
    session.updatedAt = Date.now();
    await writeFile(path, JSON.stringify(session, null, 2), "utf8");
    this.cache.set(this.cacheKey(session.channel, session.peerId), session);
  }

  async appendMessage(
    channel: Channel,
    peerId: string,
    message: Omit<StoredChatMessage, "id" | "at"> & { id?: string; at?: number },
  ): Promise<ChatSessionFile> {
    const session = await this.getSession(channel, peerId);
    session.messages.push({
      id: message.id ?? randomUUID(),
      role: message.role,
      content: message.content,
      at: message.at ?? Date.now(),
      tokens: message.tokens,
      numTurns: message.numTurns,
    });
    if (message.role === "user" && !session.title) {
      session.title = message.content.slice(0, 80);
    }
    await this.persist(session);
    return session;
  }

  async setClaudeSessionId(
    channel: Channel,
    peerId: string,
    claudeSessionId: string,
  ): Promise<void> {
    const session = await this.getSession(channel, peerId);
    session.claudeSessionId = claudeSessionId;
    await this.persist(session);
  }

  async renameSession(channel: Channel, peerId: string, title: string): Promise<ChatSessionFile> {
    const trimmed = title.trim().replace(/\s+/g, " ");
    if (!trimmed) throw new Error("会话名称不能为空");
    if (trimmed.length > 120) throw new Error("会话名称不能超过 120 个字符");

    const session = await this.getSession(channel, peerId);
    session.title = trimmed;
    await this.persist(session);
    return session;
  }

  async listWebSessions(): Promise<
    Array<{
      sessionId: string;
      title?: string;
      updatedAt: number;
      messageCount: number;
      claudeSessionId?: string;
    }>
  > {
    const dir = join(getDataDir(), "chats", "web");
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }

    const out: Array<{
      sessionId: string;
      title?: string;
      updatedAt: number;
      messageCount: number;
      claudeSessionId?: string;
    }> = [];

    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, name), "utf8");
        const data = JSON.parse(raw) as ChatSessionFile;
        out.push({
          sessionId: data.peerId,
          title: data.title,
          updatedAt: data.updatedAt,
          messageCount: data.messages.length,
          claudeSessionId: data.claudeSessionId,
        });
      } catch {
        /* skip corrupt */
      }
    }

    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

export const chatHistoryStore = new ChatHistoryStore();
