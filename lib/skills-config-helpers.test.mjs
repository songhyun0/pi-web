import assert from "node:assert/strict";
import test from "node:test";

const {
  diagnosticMatchesSkill,
  displaySkillPath,
  shortenPath,
  sourceGroup,
  sourceKind,
  sourceSummary,
  splitSearchPackage,
} = await import("../components/skills-config/helpers.ts");

function skill(overrides = {}) {
  return {
    name: "repo-audit",
    description: "Audit a repository",
    filePath: "/Users/demo/work/pi-web/.agents/skills/repo-audit/SKILL.md",
    baseDir: "/Users/demo/work/pi-web/.agents/skills/repo-audit",
    disableModelInvocation: false,
    sourceInfo: {
      path: "/Users/demo/work/pi-web/.agents/skills/repo-audit/SKILL.md",
      source: "local",
      scope: "project",
      origin: "top-level",
      baseDir: "/Users/demo/work/pi-web/.agents/skills/repo-audit",
    },
    ...overrides,
  };
}

test("skill helpers classify project, global, and explicit path sources", () => {
  assert.equal(sourceGroup(skill()), "project");
  assert.equal(sourceGroup(skill({ sourceInfo: { source: "local", scope: "user", origin: "top-level" } })), "global");
  assert.equal(sourceGroup(skill({ sourceInfo: { source: "/tmp/skill", scope: "temporary", origin: "top-level" } })), "path");
  assert.equal(sourceKind(skill()), "Project");
  assert.equal(sourceKind(skill({ sourceInfo: { source: "owner/repo", scope: "user", origin: "package" } })), "Package");
});

test("skill paths use project-relative and home-shortened forms safely", () => {
  assert.equal(shortenPath("/Users/demo/.pi/agent/skills/review/SKILL.md"), "~/.pi/agent/skills/review/SKILL.md");
  assert.equal(displaySkillPath(skill(), "/Users/demo/work/pi-web"), "./.agents/skills/repo-audit/SKILL.md");
  assert.equal(displaySkillPath(skill({ filePath: "/Users/demo/work/pi-web-old/SKILL.md" }), "/Users/demo/work/pi-web"), "~/work/pi-web-old/SKILL.md");
});

test("skill source summaries identify packages and useful local directories", () => {
  assert.equal(sourceSummary(skill()), "~/work/pi-web/.agents/skills/repo-audit");
  assert.equal(sourceSummary(skill({ sourceInfo: { source: "owner/repo", scope: "user", origin: "package" } })), "owner/repo");
});

test("skill search package labels split repository and skill names", () => {
  assert.deepEqual(splitSearchPackage("owner/repo@react-review"), { repository: "owner/repo", skill: "react-review" });
  assert.deepEqual(splitSearchPackage("owner/repo"), { repository: "owner/repo", skill: "owner/repo" });
});

test("skill diagnostics match direct paths, collisions, and global messages", () => {
  const subject = skill();
  assert.equal(diagnosticMatchesSkill({ type: "warning", message: "global" }, subject), true);
  assert.equal(diagnosticMatchesSkill({ type: "error", message: "direct", path: subject.filePath }, subject), true);
  assert.equal(diagnosticMatchesSkill({
    type: "collision",
    message: "collision",
    collision: {
      resourceType: "skill",
      name: subject.name,
      winnerPath: "/other/SKILL.md",
      loserPath: subject.filePath,
    },
  }, subject), true);
  assert.equal(diagnosticMatchesSkill({ type: "warning", message: "other", path: "/other/SKILL.md" }, subject), false);
});
