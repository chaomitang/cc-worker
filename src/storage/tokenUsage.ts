import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

export type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** input + output + cache read + cache creation */
  totalTokens: number;
};

export const EMPTY_TOKEN_TOTALS: TokenTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  totalTokens: 0,
};

function readNum(obj: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

export function tokensFromUsageObject(usage: unknown): TokenTotals {
  if (!usage || typeof usage !== "object") return { ...EMPTY_TOKEN_TOTALS };
  const u = usage as Record<string, unknown>;
  const inputTokens = readNum(u, "input_tokens", "inputTokens");
  const outputTokens = readNum(u, "output_tokens", "outputTokens");
  const cacheReadInputTokens = readNum(u, "cache_read_input_tokens", "cacheReadInputTokens");
  const cacheCreationInputTokens = readNum(
    u,
    "cache_creation_input_tokens",
    "cacheCreationInputTokens",
  );
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    totalTokens: inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens,
  };
}

export function addTokenTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/** Per-query tokens from SDK result (usage + modelUsage fallback). */
export function extractTokensFromResult(message: SDKResultMessage): TokenTotals {
  if (message.type !== "result") return { ...EMPTY_TOKEN_TOTALS };

  let totals = tokensFromUsageObject(message.usage);

  const modelUsage = message.modelUsage as Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }> | undefined;
  if (modelUsage && typeof modelUsage === "object") {
    let fromModels = { ...EMPTY_TOKEN_TOTALS };
    for (const m of Object.values(modelUsage)) {
      if (!m || typeof m !== "object") continue;
      fromModels = addTokenTotals(fromModels, {
        inputTokens: m.inputTokens ?? 0,
        outputTokens: m.outputTokens ?? 0,
        cacheReadInputTokens: m.cacheReadInputTokens ?? 0,
        cacheCreationInputTokens: m.cacheCreationInputTokens ?? 0,
        totalTokens: 0,
      });
    }
    fromModels.totalTokens =
      fromModels.inputTokens +
      fromModels.outputTokens +
      fromModels.cacheReadInputTokens +
      fromModels.cacheCreationInputTokens;
    if (totals.totalTokens === 0 && fromModels.totalTokens > 0) {
      totals = fromModels;
    }
  }

  return totals;
}

export function formatTokenTotals(t: TokenTotals): string {
  const parts = [`↑${formatK(t.inputTokens)}`, `↓${formatK(t.outputTokens)}`];
  if (t.cacheReadInputTokens > 0) parts.push(`cache读${formatK(t.cacheReadInputTokens)}`);
  if (t.cacheCreationInputTokens > 0) parts.push(`cache写${formatK(t.cacheCreationInputTokens)}`);
  return `${parts.join(" · ")} · 共 ${formatK(t.totalTokens)}`;
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
