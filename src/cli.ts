#!/usr/bin/env node
import "./loadEnv.js";
import { CcWorkerAgent } from "./agent/CcWorkerAgent.js";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  console.error("Usage: cc-worker <prompt>");
  console.error('Example: pnpm dev "List files in this directory"');
  process.exit(1);
}

const permissionMode = process.env.CC_WORKER_PERMISSION_MODE as
  | Options["permissionMode"]
  | undefined;

const agent = new CcWorkerAgent({
  ...(permissionMode ? { permissionMode } : {}),
});

for await (const message of agent.runStream(prompt)) {
  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "text") process.stdout.write(block.text);
    }
  }

  if (message.type === "result") {
    if (message.subtype === "success") {
      console.log(
        `\n\n--- session: ${message.session_id} | cost: $${message.total_cost_usd.toFixed(4)} ---`,
      );
    } else {
      console.error("\n--- failed:", message.subtype, message.errors?.join("; ") ?? "");
      process.exit(1);
    }
  }
}
