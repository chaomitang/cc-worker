import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type SkillInfo = {
  name: string;
  source: "user" | "project";
  path: string;
  description: string;
};

async function readSkillMd(skillDir: string, name: string): Promise<SkillInfo | null> {
  const skillPath = join(skillDir, name, "SKILL.md");
  try {
    const content = await readFile(skillPath, "utf8");
    const description = parseDescription(content);
    return {
      name,
      source: skillDir.includes(homedir()) ? "user" : "project",
      path: skillPath,
      description,
    };
  } catch {
    return null;
  }
}

function parseDescription(content: string): string {
  const fm = content.match(/^---\s*[\s\S]*?description:\s*["']?([^"'\n]+)/m);
  if (fm?.[1]) return fm[1].trim();
  const line = content.split("\n").find((l) => l.trim() && !l.startsWith("#"));
  return line?.trim().slice(0, 120) ?? "";
}

async function scanSkillsRoot(root: string, source: "user" | "project"): Promise<SkillInfo[]> {
  const skillsDir = join(root, "skills");
  try {
    const st = await stat(skillsDir);
    if (!st.isDirectory()) return [];
  } catch {
    return [];
  }

  const entries = await readdir(skillsDir, { withFileTypes: true });
  const out: SkillInfo[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skill = await readSkillMd(skillsDir, ent.name);
    if (skill) out.push({ ...skill, source });
  }
  return out;
}

export async function discoverSkills(cwd: string): Promise<SkillInfo[]> {
  const userRoot = join(homedir(), ".claude");
  const projectRoot = join(cwd, ".claude");

  const [userSkills, projectSkills] = await Promise.all([
    scanSkillsRoot(userRoot, "user"),
    scanSkillsRoot(projectRoot, "project"),
  ]);

  const byName = new Map<string, SkillInfo>();
  for (const s of userSkills) byName.set(s.name, s);
  for (const s of projectSkills) byName.set(s.name, s);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
