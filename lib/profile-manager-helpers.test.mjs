import assert from "node:assert/strict";
import test from "node:test";

const {
  formatProfileDate,
  packageLabel,
  packageSource,
  presetDescription,
  presetLabel,
  profileSummary,
  shortenPath,
} = await import("../components/profile-manager/helpers.ts");

function profile(overrides = {}) {
  return {
    id: "profile:review",
    name: "Review",
    tools: { builtinPreset: "default", pluginTools: "fromSelectedPlugins" },
    plugins: [],
    skills: { mode: "pluginDefaultThenNarrow" },
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

test("profile helpers shorten home paths without changing other roots", () => {
  assert.equal(shortenPath("/Users/demo/work/pi-web"), "~/work/pi-web");
  assert.equal(shortenPath("/home/demo/work/pi-web"), "~/work/pi-web");
  assert.equal(shortenPath("/var/tmp/pi-web"), "/var/tmp/pi-web");
});

test("profile package helpers preserve sources and produce compact labels", () => {
  assert.equal(packageSource("npm:@pi/review"), "npm:@pi/review");
  assert.equal(packageSource({ source: "git:github.com/pi/review" }), "git:github.com/pi/review");
  assert.equal(packageLabel("npm:@pi/review"), "@pi/review");
  assert.equal(packageLabel("git:github.com/pi/review"), "review");
});

test("profile preset copy distinguishes each built-in boundary", () => {
  assert.equal(presetLabel("none"), "No built-ins");
  assert.equal(presetLabel("default"), "Standard tools");
  assert.equal(presetLabel("full"), "Full tools");
  assert.match(presetDescription("none"), /selected plugins/);
  assert.match(presetDescription("full"), /project search/);
});

test("profile summaries include plugin and hidden-skill counts", () => {
  assert.equal(profileSummary(profile()), "Standard tools · 0 plugins");
  assert.equal(profileSummary(profile({
    tools: { builtinPreset: "full", pluginTools: "fromSelectedPlugins" },
    plugins: ["npm:a", "npm:b"],
    skills: {
      mode: "pluginDefaultThenNarrow",
      disabledSkillRefs: [{ source: "npm:a", scope: "package", path: "skills/a/SKILL.md" }],
    },
  })), "Full tools · 2 plugins · 1 skill hidden");
});

test("profile dates are readable while invalid values are preserved", () => {
  assert.match(formatProfileDate("2026-07-10T00:00:00.000Z"), /2026/);
  assert.equal(formatProfileDate("not-a-date"), "not-a-date");
});
