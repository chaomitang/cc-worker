import type { Express, Request, Response } from "express";
import multer from "multer";
import {
  createSkillScaffold,
  deleteSkill,
  installSkillFromZip,
  listSkillsWithMeta,
  openSkillDirectory,
  readSkillMarkdown,
  type SkillTarget,
} from "../services/skillsManage.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/zip" || file.originalname.toLowerCase().endsWith(".zip")) {
      cb(null, true);
    } else {
      cb(new Error("仅支持 .zip 文件"));
    }
  },
});

function projectCwd(): string {
  return process.env.CC_WORKER_CWD ?? process.cwd();
}

function parseTarget(value: unknown): SkillTarget {
  return value === "user" ? "user" : "project";
}

export function registerSkillsRoutes(app: Express): void {
  app.get("/api/skills/locations", async (_req, res) => {
    try {
      const data = await listSkillsWithMeta(projectCwd());
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: formatErr(err) });
    }
  });

  app.get("/api/skills", async (_req, res) => {
    try {
      const { locations, skills } = await listSkillsWithMeta(projectCwd());
      res.json({ cwd: locations.cwd, count: skills.length, skills, locations });
    } catch (err) {
      res.status(500).json({ error: formatErr(err) });
    }
  });

  app.post(
    "/api/skills/upload",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        if (!req.file?.buffer) {
          res.status(400).json({ error: "请上传 zip 文件（字段名 file）" });
          return;
        }
        const target = parseTarget(req.body?.target);
        const overwrite = req.body?.overwrite === "true" || req.body?.overwrite === true;
        const result = await installSkillFromZip(req.file.buffer, target, projectCwd(), {
          overwrite,
          fallbackName: req.file.originalname,
        });
        const { skills, locations } = await listSkillsWithMeta(projectCwd());
        res.json({ ...result, skills, locations });
      } catch (err) {
        res.status(400).json({ error: formatErr(err) });
      }
    },
  );

  app.post("/api/skills/create", async (req, res) => {
    try {
      const name = String(req.body?.name ?? "").trim();
      if (!name) {
        res.status(400).json({ error: "name 必填" });
        return;
      }
      const target = parseTarget(req.body?.target);
      const created = await createSkillScaffold(name, target, projectCwd());
      const { skills, locations } = await listSkillsWithMeta(projectCwd());
      res.json({ created, skills, locations });
    } catch (err) {
      res.status(400).json({ error: formatErr(err) });
    }
  });

  app.post("/api/skills/open-folder", async (req, res) => {
    try {
      const target = parseTarget(req.body?.target);
      const opened = await openSkillDirectory(target, projectCwd());
      res.json({
        ok: true,
        ...opened,
        hint: "在运行 cc-worker 的本机打开文件管理器；远程服务器上可能无效",
      });
    } catch (err) {
      res.status(500).json({ error: formatErr(err) });
    }
  });

  app.get("/api/skills/:target/:name/content", async (req, res) => {
    try {
      const target = parseTarget(req.params.target);
      const content = await readSkillMarkdown(target, req.params.name, projectCwd());
      res.json({ content });
    } catch (err) {
      res.status(404).json({ error: formatErr(err) });
    }
  });

  app.delete("/api/skills/:target/:name", async (req, res) => {
    try {
      const target = parseTarget(req.params.target);
      await deleteSkill(target, req.params.name, projectCwd());
      const { skills, locations } = await listSkillsWithMeta(projectCwd());
      res.json({ deleted: true, skills, locations });
    } catch (err) {
      res.status(400).json({ error: formatErr(err) });
    }
  });
}

function formatErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
