import AdmZip from "adm-zip";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { discoverSkills, type SkillInfo } from "./skillsDiscovery.js";

export type SkillTarget = "project" | "user";

export type SkillLocations = {
  cwd: string;
  project: { skillsDir: string; claudeDir: string };
  user: { skillsDir: string; claudeDir: string };
  layout: string;
};

export function getSkillLocations(cwd: string): SkillLocations {
  const projectClaude = join(cwd, ".claude");
  const userClaude = join(homedir(), ".claude");
  return {
    cwd,
    project: {
      skillsDir: join(projectClaude, "skills"),
      claudeDir: projectClaude,
    },
    user: {
      skillsDir: join(userClaude, "skills"),
      claudeDir: userClaude,
    },
    layout: ".claude/skills/<skill-name>/SKILL.md",
  };
}

function skillsDirFor(target: SkillTarget, cwd: string): string {
  const loc = getSkillLocations(cwd);
  return target === "user" ? loc.user.skillsDir : loc.project.skillsDir;
}

function sanitizeSkillName(name: string): string {
  const n = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  if (!n) throw new Error("无效的技能名称");
  return n;
}

async function findSkillPackageDirs(root: string): Promise<Array<{ name: string; dir: string }>> {
  const found: Array<{ name: string; dir: string }> = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 5) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const hasSkillMd = entries.some((e) => e.isFile() && e.name === "SKILL.md");
    if (hasSkillMd) {
      found.push({ name: basename(dir), dir });
      return;
    }

    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".")) {
        await walk(join(dir, e.name), depth + 1);
      }
    }
  }

  await walk(root, 0);
  return found;
}

export type InstallSkillResult = {
  installed: Array<{ name: string; path: string; target: SkillTarget }>;
};

export async function installSkillFromZip(
  buffer: Buffer,
  target: SkillTarget,
  cwd: string,
  options?: { overwrite?: boolean; fallbackName?: string },
): Promise<InstallSkillResult> {
  const destRoot = skillsDirFor(target, cwd);
  await mkdir(destRoot, { recursive: true });

  const tmp = await mkdtemp(join(tmpdir(), "cc-skill-"));
  try {
    const zip = new AdmZip(buffer);
    zip.extractAllTo(tmp, true);

    let packages = await findSkillPackageDirs(tmp);

    if (packages.length === 0) {
      const flatSkill = join(tmp, "SKILL.md");
      try {
        await stat(flatSkill);
        const name = sanitizeSkillName(
          options?.fallbackName?.replace(/\.zip$/i, "") ?? "imported-skill",
        );
        packages = [{ name, dir: tmp }];
      } catch {
        throw new Error(
          "ZIP 中未找到 SKILL.md。请使用目录结构：<技能名>/SKILL.md",
        );
      }
    }

    const installed: InstallSkillResult["installed"] = [];

    for (const pkg of packages) {
      const skillName = sanitizeSkillName(pkg.name);
      const destDir = join(destRoot, skillName);

      try {
        await stat(destDir);
        if (!options?.overwrite) {
          throw new Error(`技能「${skillName}」已存在，请勾选「覆盖」或先删除`);
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }

      await rm(destDir, { recursive: true, force: true });
      await cp(pkg.dir, destDir, { recursive: true });

      installed.push({ name: skillName, path: destDir, target });
    }

    return { installed };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function deleteSkill(
  target: SkillTarget,
  name: string,
  cwd: string,
): Promise<void> {
  const skillName = sanitizeSkillName(name);
  const dir = join(skillsDirFor(target, cwd), skillName);
  const resolved = resolve(dir);
  const root = resolve(skillsDirFor(target, cwd));
  if (!resolved.startsWith(root)) {
    throw new Error("非法路径");
  }
  await rm(resolved, { recursive: true, force: true });
}

export async function readSkillMarkdown(
  target: SkillTarget,
  name: string,
  cwd: string,
): Promise<string> {
  const skillName = sanitizeSkillName(name);
  const path = join(skillsDirFor(target, cwd), skillName, "SKILL.md");
  return readFile(path, "utf8");
}

export async function openSkillDirectory(
  target: SkillTarget,
  cwd: string,
): Promise<{ path: string; command: string }> {
  const dir = skillsDirFor(target, cwd);
  await mkdir(dir, { recursive: true });
  const path = resolve(dir);

  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer"
        : "xdg-open";

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, [path], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", reject);
    child.unref();
    resolvePromise();
  });

  return { path, command };
}

export async function listSkillsWithMeta(cwd: string): Promise<{
  locations: SkillLocations;
  skills: SkillInfo[];
}> {
  await ensureSkillsDirs(cwd);
  const locations = getSkillLocations(cwd);
  const skills = await discoverSkills(cwd);
  return { locations, skills };
}

export async function ensureSkillsDirs(cwd: string): Promise<void> {
  const loc = getSkillLocations(cwd);
  await mkdir(loc.project.skillsDir, { recursive: true });
  await mkdir(loc.user.skillsDir, { recursive: true });
}

export async function createSkillScaffold(
  name: string,
  target: SkillTarget,
  cwd: string,
): Promise<{ path: string }> {
  const skillName = sanitizeSkillName(name);
  const dir = join(skillsDirFor(target, cwd), skillName);
  await mkdir(dir, { recursive: true });
  const skillPath = join(dir, "SKILL.md");
  try {
    await stat(skillPath);
    throw new Error(`技能 ${skillName} 已存在`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const content = `---
name: ${skillName}
description: ${skillName} skill
---

# ${skillName}

在此编写技能说明与使用方式。
`;
  await writeFile(skillPath, content, "utf8");
  return { path: dir };
}
