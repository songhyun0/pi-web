import assert from "node:assert/strict";
import test from "node:test";
import {
  MOBILE_INSPECTOR_FILES_HISTORY_KEY,
  MOBILE_SESSION_PROJECT_HISTORY_KEY,
  MOBILE_WORKSPACE_HISTORY_KEY,
  readMobileInspectorFiles,
  readMobileSessionProject,
  readMobileWorkspaceLayer,
  withMobileInspectorFiles,
  withMobileSessionProject,
  withMobileWorkspaceLayer,
  withoutMobileInspectorFiles,
  withoutMobileSessionProject,
  withoutMobileWorkspaceLayer,
} from "./mobile-workspace.ts";

test("mobile workspace history preserves router-owned state", () => {
  const routerState = { __NA: true, tree: ["", {}] };
  const layered = withMobileWorkspaceLayer(routerState, "sessions");

  assert.equal(readMobileWorkspaceLayer(layered), "sessions");
  assert.equal(layered.__NA, true);
  assert.deepEqual(layered.tree, routerState.tree);
  assert.deepEqual(routerState, { __NA: true, tree: ["", {}] });

  const cleared = withoutMobileWorkspaceLayer(layered);
  assert.equal(readMobileWorkspaceLayer(cleared), null);
  assert.equal(MOBILE_WORKSPACE_HISTORY_KEY in cleared, false);
  assert.equal(cleared.__NA, true);
});

test("mobile workspace history ignores malformed and unknown layers", () => {
  assert.equal(readMobileWorkspaceLayer(null), null);
  assert.equal(readMobileWorkspaceLayer([]), null);
  assert.equal(readMobileWorkspaceLayer({ [MOBILE_WORKSPACE_HISTORY_KEY]: "chat" }), null);
  assert.equal(readMobileWorkspaceLayer({ [MOBILE_WORKSPACE_HISTORY_KEY]: "inspector" }), "inspector");
});

test("mobile project drill-down composes with the workspace layer", () => {
  const sessionsLayer = withMobileWorkspaceLayer({ __NA: true }, "sessions");
  const projectLayer = withMobileSessionProject(sessionsLayer, "/work/pi-web");

  assert.equal(readMobileWorkspaceLayer(projectLayer), "sessions");
  assert.equal(readMobileSessionProject(projectLayer), "/work/pi-web");
  assert.equal(projectLayer.__NA, true);

  const cleared = withoutMobileSessionProject(projectLayer);
  assert.equal(readMobileSessionProject(cleared), null);
  assert.equal(readMobileWorkspaceLayer(cleared), "sessions");
  assert.equal(MOBILE_SESSION_PROJECT_HISTORY_KEY in cleared, false);
});

test("inspector file sheet composes with router and inspector state", () => {
  const inspector = withMobileWorkspaceLayer({ __NA: true, tree: ["", {}] }, "inspector");
  const files = withMobileInspectorFiles(inspector);

  assert.equal(readMobileInspectorFiles(files), true);
  assert.equal(readMobileWorkspaceLayer(files), "inspector");
  assert.equal(files.__NA, true);
  assert.equal(MOBILE_INSPECTOR_FILES_HISTORY_KEY in inspector, false);

  const cleared = withoutMobileInspectorFiles(files);
  assert.equal(readMobileInspectorFiles(cleared), false);
  assert.equal(readMobileWorkspaceLayer(cleared), "inspector");
  assert.equal(MOBILE_INSPECTOR_FILES_HISTORY_KEY in cleared, false);
});
