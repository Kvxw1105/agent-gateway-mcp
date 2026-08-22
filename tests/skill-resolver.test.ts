import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  composePromptWithSkills,
  resolveSkills,
  type ResolvedSkill,
} from "../src/skill-resolver.js";

test("resolves a skill name from configured roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gateway-skills-"));
  try {
    const skillDir = path.join(root, "example-skill");
    await mkdir(skillDir);
    await writeFile(path.join(skillDir, "SKILL.md"), "# Example\nDo the work.\n");
    const resolved = await resolveSkills(["example-skill"], { roots: [root] });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.name, "example-skill");
    assert.equal(resolved[0]?.path, path.join(skillDir, "SKILL.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("accepts an absolute SKILL.md path inside an allowed root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gateway-skills-"));
  try {
    const skillDir = path.join(root, "absolute-skill");
    await mkdir(skillDir);
    const skillPath = path.join(skillDir, "SKILL.md");
    await writeFile(skillPath, "# Absolute\n");
    const resolved = await resolveSkills([skillPath], { roots: [root] });
    assert.equal(resolved[0]?.path, skillPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects traversal and files not named SKILL.md", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gateway-skills-"));
  try {
    await assert.rejects(() => resolveSkills(["../escape"], { roots: [root] }), /invalid skill name/u);
    const wrongFile = path.join(root, "notes.md");
    await writeFile(wrongFile, "secret");
    await assert.rejects(() => resolveSkills([wrongFile], { roots: [root] }), /SKILL\.md/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a symlink that escapes an allowed root", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gateway-skills-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "gateway-skills-outside-"));
  try {
    await writeFile(path.join(outside, "SKILL.md"), "outside");
    const link = path.join(root, "escaped");
    try {
      await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`symlink unavailable: ${String(error)}`);
      return;
    }
    await assert.rejects(() => resolveSkills(["escaped"], { roots: [root] }), /outside allowed roots/u);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("reference mode injects paths but never skill contents", () => {
  const skills: ResolvedSkill[] = [{ name: "alpha", path: "C:\\skills\\alpha\\SKILL.md", content: "TOP_SECRET" }];
  const composed = composePromptWithSkills("Do task", skills, "reference", { maxChars: 1_000 });
  assert.match(composed, /C:\\skills\\alpha\\SKILL\.md/u);
  assert.match(composed, /read.*referenced files/u);
  assert.doesNotMatch(composed, /TOP_SECRET/u);
});

test("full mode injects bounded contents and enforces the composed prompt cap", () => {
  const skills: ResolvedSkill[] = [{ name: "alpha", path: "/skills/alpha/SKILL.md", content: "follow alpha" }];
  assert.match(composePromptWithSkills("Do task", skills, "full", { maxChars: 1_000 }), /follow alpha/u);
  assert.throws(
    () => composePromptWithSkills("x".repeat(990), skills, "full", { maxChars: 1_000 }),
    /composed prompt exceeds/u,
  );
  assert.throws(
    () => composePromptWithSkills("Do task", [{ ...skills[0]!, content: "x".repeat(101) }], "full", {
      maxChars: 1_000,
      maxSkillChars: 100,
    }),
    /skill content exceeds/u,
  );
});
