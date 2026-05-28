import type { CanUseTool, Options } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionBroker } from "../services/permissionBroker.js";

export type PermissionPolicyConfig = {
  permissionMode?: Options["permissionMode"];
  allowDangerouslySkipPermissions?: boolean;
  /** When true, route permission prompts to PermissionBroker (Web UI). */
  interactivePermissions?: boolean;
};

export function loadPermissionPolicyFromEnv(): PermissionPolicyConfig {
  const mode = (process.env.CC_WORKER_PERMISSION_MODE ??
    "acceptEdits") as Options["permissionMode"];

  const allowDangerouslySkipPermissions =
    process.env.CC_WORKER_ALLOW_DANGEROUS_SKIP === "1" ||
    process.env.CC_WORKER_ALLOW_DANGEROUS_SKIP === "true";

  const interactivePermissions =
    process.env.CC_WORKER_INTERACTIVE_PERMISSIONS === "1" ||
    process.env.CC_WORKER_INTERACTIVE_PERMISSIONS === "true";

  return {
    permissionMode: mode,
    allowDangerouslySkipPermissions,
    interactivePermissions,
  };
}

/**
 * SDK query() has no terminal — use permissionMode and/or canUseTool.
 * bypassPermissions: no prompts. acceptEdits: auto Edit only; Write may still ask.
 * interactive + broker: show Allow/Deny in Web UI via canUseTool.
 */
export function buildCanUseTool(
  policy: PermissionPolicyConfig,
  broker?: PermissionBroker,
  onPending?: (pending: import("../services/permissionBroker.js").PendingPermission) => void,
): CanUseTool | undefined {
  if (policy.permissionMode === "bypassPermissions") {
    return undefined;
  }

  if (!policy.interactivePermissions || !broker) {
    return undefined;
  }

  return async (toolName, input, options) =>
    broker.wait(
      toolName,
      input ?? {},
      {
        title: options.title,
        displayName: options.displayName,
        description: options.description,
        suggestions: options.suggestions,
      },
      onPending,
    );
}

export function applyPermissionOptions(
  policy: PermissionPolicyConfig,
  options: Options,
  canUseTool?: CanUseTool,
): Options {
  const out: Options = { ...options };

  if (policy.permissionMode) {
    out.permissionMode = policy.permissionMode;
  }

  if (policy.permissionMode === "bypassPermissions" && policy.allowDangerouslySkipPermissions) {
    out.allowDangerouslySkipPermissions = true;
  }

  if (canUseTool) {
    out.canUseTool = canUseTool;
  }

  return out;
}
