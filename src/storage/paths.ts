import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export function getDataDir(): string {
  return process.env.CC_WORKER_DATA_DIR ?? join(process.cwd(), ".data");
}

export async function ensureDataDir(...segments: string[]): Promise<string> {
  const dir = join(getDataDir(), ...segments);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Safe filename segment (session id, peer id). */
export function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}
