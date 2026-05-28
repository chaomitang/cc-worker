import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Channel } from "../session/SessionStore.js";
import { ensureDataDir, getDataDir, safeId } from "./paths.js";
import {
  addTokenTotals,
  EMPTY_TOKEN_TOTALS,
  type TokenTotals,
} from "./tokenUsage.js";

export type UsageQueryRecord = {
  id: string;
  at: number;
  promptPreview: string;
  tokens: TokenTotals;
  numTurns?: number;
};

export type UsageLedger = {
  channel: Channel;
  peerId: string;
  updatedAt: number;
  queryCount: number;
  totals: TokenTotals;
  queries: UsageQueryRecord[];
};

const MAX_QUERIES_IN_FILE = 200;

export class UsageStore {
  private readonly cache = new Map<string, UsageLedger>();

  private cacheKey(channel: Channel, peerId: string): string {
    return `${channel}:${peerId}`;
  }

  private filePath(channel: Channel, peerId: string): string {
    return join(getDataDir(), "usage", channel, `${safeId(peerId)}.json`);
  }

  async getLedger(channel: Channel, peerId: string): Promise<UsageLedger> {
    const key = this.cacheKey(channel, peerId);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const path = this.filePath(channel, peerId);
    try {
      const raw = await readFile(path, "utf8");
      const data = JSON.parse(raw) as UsageLedger;
      this.cache.set(key, data);
      return data;
    } catch {
      const empty: UsageLedger = {
        channel,
        peerId,
        updatedAt: Date.now(),
        queryCount: 0,
        totals: { ...EMPTY_TOKEN_TOTALS },
        queries: [],
      };
      this.cache.set(key, empty);
      return empty;
    }
  }

  async recordQuery(
    channel: Channel,
    peerId: string,
    input: {
      promptPreview: string;
      tokens: TokenTotals;
      numTurns?: number;
    },
  ): Promise<UsageLedger> {
    await ensureDataDir("usage", channel);
    const ledger = await this.getLedger(channel, peerId);

    const record: UsageQueryRecord = {
      id: randomUUID(),
      at: Date.now(),
      promptPreview: input.promptPreview.slice(0, 120),
      tokens: input.tokens,
      numTurns: input.numTurns,
    };

    ledger.queries.push(record);
    if (ledger.queries.length > MAX_QUERIES_IN_FILE) {
      ledger.queries = ledger.queries.slice(-MAX_QUERIES_IN_FILE);
    }
    ledger.queryCount += 1;
    ledger.totals = addTokenTotals(ledger.totals, input.tokens);
    ledger.updatedAt = Date.now();

    const path = this.filePath(channel, peerId);
    await writeFile(path, JSON.stringify(ledger, null, 2), "utf8");
    this.cache.set(this.cacheKey(channel, peerId), ledger);
    return ledger;
  }
}

export const usageStore = new UsageStore();
