import { randomUUID } from "node:crypto";
import type { PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";

export type PendingPermission = {
  id: string;
  toolName: string;
  title?: string;
  displayName?: string;
  description?: string;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  createdAt: number;
};

/** SDK Zod schema requires `updatedInput` to be a record when allowing — not undefined. */
export function buildAllowResult(
  input: Record<string, unknown> | undefined,
  suggestions?: PermissionUpdate[],
): PermissionResult {
  const result: PermissionResult = {
    behavior: "allow",
    updatedInput: input ?? {},
  };
  if (suggestions?.length) {
    result.updatedPermissions = suggestions;
  }
  return result;
}

type PendingEntry = {
  info: PendingPermission;
  resolve: (result: PermissionResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Bridges SDK canUseTool callbacks to HTTP/SSE clients (query mode has no TTY).
 */
export class PermissionBroker {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly timeoutMs: number;

  constructor(timeoutMs = 120_000) {
    this.timeoutMs = timeoutMs;
  }

  wait(
    toolName: string,
    input: Record<string, unknown>,
    meta: {
      title?: string;
      displayName?: string;
      description?: string;
      suggestions?: PermissionUpdate[];
    },
    onRegistered?: (info: PendingPermission) => void,
  ): Promise<PermissionResult> {
    const id = randomUUID();
    const info: PendingPermission = {
      id,
      toolName,
      title: meta.title,
      displayName: meta.displayName,
      description: meta.description,
      input: input ?? {},
      suggestions: meta.suggestions,
      createdAt: Date.now(),
    };

    onRegistered?.(info);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          behavior: "deny",
          message: "权限请求超时（未在 Web 控制台批准）",
        });
      }, this.timeoutMs);

      this.pending.set(id, {
        info,
        timer,
        resolve,
      });
    });
  }

  respond(id: string, allow: boolean): PendingPermission | null {
    const entry = this.pending.get(id);
    if (!entry) return null;

    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(
      allow
        ? buildAllowResult(entry.info.input, entry.info.suggestions)
        : { behavior: "deny", message: "用户拒绝了该操作" },
    );
    return entry.info;
  }

  listPending(): PendingPermission[] {
    return [...this.pending.values()].map((e) => e.info);
  }

  size(): number {
    return this.pending.size;
  }
}
