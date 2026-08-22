import { access, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type SkillMode = "reference" | "full";

export interface ResolvedSkill {
  name: string;
  path: string;
  content: string;
}

export interface ResolveSkillOptions {
  roots?: string[];
  maxSkills?: number;
}

export interface ComposeSkillOptions {
  maxChars: number;
  maxSkillChars?: number;
  maxTotalSkillChars?: number;
}

const DEFAULT_MAX_SKILLS = 4;
const DEFAULT_MAX_SKILL_CHARS = 20_000;
const DEFAULT_MAX_TOTAL_SKILL_CHARS = 48_000;

export function defaultSkillRoots(): string[] {
  const configured = process.env.AGENT_GATEWAY_SKILL_ROOTS
    ?.split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
  return [
    path.join(os.homedir(), ".codex", "skills"),
    path.join(os.homedir(), ".agents", "skills"),
    path.resolve(process.cwd(), "integrations", "skills"),
    ...configured,
  ];
}

export async function resolveSkills(
  requested: string[],
  options: ResolveSkillOptions = {},
): Promise<ResolvedSkill[]> {
  const maxSkills = options.maxSkills ?? DEFAULT_MAX_SKILLS;
  if (requested.length > maxSkills) throw new Error(`at most ${maxSkills} skills may be requested`);
  if (requested.length === 0) return [];

  const roots = await canonicalExistingRoots(options.roots ?? defaultSkillRoots());
  if (roots.length === 0) throw new Error("no configured skill roots are available");

  const resolved: ResolvedSkill[] = [];
  for (const request of requested) {
    const skillPath = path.isAbsolute(request)
      ? await resolveAbsoluteSkill(request, roots)
      : await resolveNamedSkill(request, roots);
    resolved.push({
      name: path.basename(path.dirname(skillPath)),
      path: skillPath,
      content: await readFile(skillPath, "utf8"),
    });
  }
  return resolved;
}

export function composePromptWithSkills(
  prompt: string,
  skills: ResolvedSkill[],
  mode: SkillMode,
  options: ComposeSkillOptions,
): string {
  if (skills.length === 0) return prompt;
  const maxSkillChars = options.maxSkillChars ?? DEFAULT_MAX_SKILL_CHARS;
  const maxTotalSkillChars = options.maxTotalSkillChars ?? DEFAULT_MAX_TOTAL_SKILL_CHARS;
  let skillBlock: string;

  if (mode === "reference") {
    const paths = skills.map((skill) => `- ${skill.path}`).join("\n");
    skillBlock = [
      "Before acting, read these SKILL.md files completely and follow them. Also read only the referenced files they require for this task:",
      paths,
    ].join("\n");
  } else {
    let total = 0;
    const sections = skills.map((skill) => {
      if (skill.content.length > maxSkillChars) {
        throw new Error(`skill content exceeds ${maxSkillChars} characters: ${skill.name}`);
      }
      total += skill.content.length;
      if (total > maxTotalSkillChars) {
        throw new Error(`total skill content exceeds ${maxTotalSkillChars} characters`);
      }
      return `--- SKILL ${skill.name} (${skill.path}) ---\n${skill.content}`;
    });
    skillBlock = `Follow these injected skill instructions:\n${sections.join("\n")}`;
  }

  const composed = `${skillBlock}\n\nUser task:\n${prompt}`;
  if (composed.length > options.maxChars) {
    throw new Error(`composed prompt exceeds ${options.maxChars} characters`);
  }
  return composed;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function canonicalExistingRoots(roots: string[]): Promise<string[]> {
  const canonical: string[] = [];
  for (const root of roots) {
    try {
      canonical.push(await realpath(path.resolve(root)));
    } catch {
      // Optional roots may not be installed.
    }
  }
  return [...new Set(canonical)];
}

async function resolveAbsoluteSkill(request: string, roots: string[]): Promise<string> {
  if (path.basename(request).toLowerCase() !== "skill.md") {
    throw new Error("absolute skill path must name a SKILL.md file");
  }
  let canonical: string;
  try {
    canonical = await realpath(request);
  } catch {
    throw new Error("requested SKILL.md file was not found");
  }
  if (!roots.some((root) => isWithin(canonical, root))) {
    throw new Error("requested skill resolves outside allowed roots");
  }
  return canonical;
}

async function resolveNamedSkill(request: string, roots: string[]): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(request) || request === "." || request === "..") {
    throw new Error("invalid skill name");
  }
  for (const root of roots) {
    const candidate = path.join(root, request, "SKILL.md");
    try {
      await access(candidate);
      const canonical = await realpath(candidate);
      if (!isWithin(canonical, root)) throw new Error("requested skill resolves outside allowed roots");
      return canonical;
    } catch (error) {
      if (error instanceof Error && /outside allowed roots/u.test(error.message)) throw error;
    }
  }
  throw new Error(`skill not found: ${request}`);
}
