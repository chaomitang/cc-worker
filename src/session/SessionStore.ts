import { CcWorkerAgent } from "../agent/CcWorkerAgent.js";
import type { CcWorkerConfig } from "../agent/config.js";
import { PermissionBroker } from "../services/permissionBroker.js";

export type Channel = "web" | "weixin";

export type ActiveSession = {
  key: string;
  channel: Channel;
  peerId: string;
  createdAt: number;
  lastActiveAt: number;
  claudeSessionId?: string;
  turns: number;
};

function makeKey(channel: Channel, id: string): string {
  return `${channel}:${id}`;
}

/**
 * One CcWorkerAgent (and Claude session) per channel peer id.
 */
export class SessionStore {
  private readonly agents = new Map<string, CcWorkerAgent>();
  private readonly brokers = new Map<string, PermissionBroker>();
  private readonly meta = new Map<string, ActiveSession>();
  private readonly resumeSessionIds = new Map<string, string>();
  private readonly baseConfig: CcWorkerConfig;

  constructor(baseConfig: CcWorkerConfig = {}) {
    this.baseConfig = baseConfig;
  }

  getPermissionBroker(channel: Channel, peerId: string): PermissionBroker {
    const key = makeKey(channel, peerId);
    let broker = this.brokers.get(key);
    if (!broker) {
      broker = new PermissionBroker();
      this.brokers.set(key, broker);
    }
    return broker;
  }

  setResumeSessionId(channel: Channel, peerId: string, claudeSessionId: string): void {
    this.resumeSessionIds.set(makeKey(channel, peerId), claudeSessionId);
    const m = this.meta.get(makeKey(channel, peerId));
    if (m) m.claudeSessionId = claudeSessionId;
  }

  getClaudeSessionId(channel: Channel, peerId: string): string | undefined {
    const key = makeKey(channel, peerId);
    return this.agents.get(key)?.getSessionId() ?? this.resumeSessionIds.get(key);
  }

  getAgent(channel: Channel, peerId: string): CcWorkerAgent {
    const key = makeKey(channel, peerId);
    let agent = this.agents.get(key);
    if (!agent) {
      const resumeSessionId = this.resumeSessionIds.get(key);
      agent = new CcWorkerAgent({
        ...this.baseConfig,
        resumeSessionId,
        systemPromptAppend: [
          this.baseConfig.systemPromptAppend,
          channel === "weixin"
            ? "你正在通过微信与用户对话。回复简洁、适合手机阅读，避免过长代码块，必要时用要点列表。"
            : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
      }, this.getPermissionBroker(channel, peerId));
      this.agents.set(key, agent);
      this.meta.set(key, {
        key,
        channel,
        peerId,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        turns: 0,
      });
    }
    return agent;
  }

  touch(channel: Channel, peerId: string, claudeSessionId?: string): void {
    const key = makeKey(channel, peerId);
    const m = this.meta.get(key);
    if (!m) return;
    m.lastActiveAt = Date.now();
    m.turns += 1;
    if (claudeSessionId) m.claudeSessionId = claudeSessionId;
  }

  listActive(): ActiveSession[] {
    for (const [key, agent] of this.agents) {
      const m = this.meta.get(key);
      if (m) m.claudeSessionId = agent.getSessionId() ?? m.claudeSessionId;
    }
    return [...this.meta.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  remove(channel: Channel, peerId: string): boolean {
    const key = makeKey(channel, peerId);
    this.agents.delete(key);
    this.brokers.delete(key);
    return this.meta.delete(key);
  }

  size(): number {
    return this.agents.size;
  }
}
