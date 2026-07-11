import assert from "node:assert/strict";
import test from "node:test";

const {
  findInstalledPackage,
  installLocation,
  packageKey,
  resourceSummary,
  shortenPath,
  statusTone,
  versionSummary,
} = await import("../components/plugins-config/helpers.ts");

function plugin(overrides = {}) {
  return {
    source: "npm:@pi/example",
    packageSource: "npm:@pi/example",
    scope: "global",
    filtered: false,
    disabled: false,
    counts: { extensions: 1, skills: 2, prompts: 0, themes: 1 },
    resources: [],
    status: "loaded",
    ...overrides,
  };
}

test("plugin helpers shorten home paths and preserve package identity", () => {
  assert.equal(shortenPath("/Users/demo/work/pi-web"), "~/work/pi-web");
  assert.equal(shortenPath("/var/tmp/pi-web"), "/var/tmp/pi-web");
  assert.equal(packageKey(plugin()), "global\0npm:@pi/example");
});

test("plugin summaries distinguish resources, disabled state, and versions", () => {
  assert.equal(resourceSummary(plugin()), "1 extension · 2 skills · 1 theme");
  assert.equal(resourceSummary(plugin({ disabled: true })), "Disabled");
  assert.equal(resourceSummary(plugin({ counts: { extensions: 0, skills: 0, prompts: 0, themes: 0 } })), "No resolved resources");
  assert.equal(versionSummary(plugin({ version: "2.0.0", configuredVersion: "^2" })), "installed 2.0.0 · configured ^2");
  assert.equal(versionSummary(plugin()), "Unknown");
});

test("plugin install locations follow global and project scopes", () => {
  assert.equal(installLocation("global", "/Users/demo/work/pi-web"), "~/.pi/agent/{npm,git}");
  assert.equal(installLocation("project", "/Users/demo/work/pi-web"), "~/work/pi-web/.pi/agent/{npm,git}");
});

test("installed package matching accepts npm shorthand without crossing scopes", () => {
  const packages = [
    plugin({ source: "npm:@pi/example", scope: "global" }),
    plugin({ source: "npm:@pi/example", scope: "project" }),
  ];
  assert.equal(findInstalledPackage(packages, "@pi/example", "project")?.scope, "project");
  assert.equal(findInstalledPackage(packages, "npm:@pi/example", "global")?.scope, "global");
  assert.equal(findInstalledPackage(packages, "@pi/missing", "global"), undefined);
});

test("plugin status tones reserve semantic color for actionable states", () => {
  assert.equal(statusTone("loaded"), "neutral");
  assert.equal(statusTone("disabled"), "neutral");
  assert.equal(statusTone("installed"), "warning");
  assert.equal(statusTone("missing"), "danger");
});
