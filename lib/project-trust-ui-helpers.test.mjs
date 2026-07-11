import assert from "node:assert/strict";
import test from "node:test";

const {
  effectiveTrustSummary,
  shortenTrustPath,
  trustActionConfirmation,
  trustActionTone,
  trustDecisionLabel,
  trustResourceSummary,
  trustSourceLabel,
} = await import("../components/project-trust/helpers.ts");

test("trust summaries distinguish trusted, prompted, and denied states", () => {
  assert.deepEqual(effectiveTrustSummary({ trusted: true, source: "saved", promptRequired: false, reason: "saved" }), {
    title: "Trusted",
    eyebrow: "Project resources enabled",
    tone: "success",
  });
  assert.equal(effectiveTrustSummary({ trusted: false, source: "promptRequired", promptRequired: true, reason: "ask" }).tone, "warning");
  assert.equal(effectiveTrustSummary({ trusted: false, source: "saved", promptRequired: false, reason: "denied" }).tone, "danger");
});

test("trust source labels explain server-owned resolution", () => {
  assert.equal(trustSourceLabel("saved"), "Saved for this project");
  assert.equal(trustSourceLabel("inherited"), "Inherited from a parent folder");
  assert.equal(trustSourceLabel("defaultProjectTrust"), "Runtime default");
  assert.equal(trustSourceLabel("noProjectResources"), "No local resources detected");
  assert.equal(trustSourceLabel("promptRequired"), "Awaiting a decision");
});

test("trust actions reserve danger styling for denial", () => {
  assert.equal(trustActionTone("trust"), "success");
  assert.equal(trustActionTone("trust-parent"), "success");
  assert.equal(trustActionTone("deny"), "danger");
  assert.equal(trustActionTone("clear"), "neutral");
  assert.equal(trustActionConfirmation("trust-parent"), "Trust parent folder");
  assert.equal(trustActionConfirmation("clear"), "Clear decision");
});

test("trust update and resource copy remains explicit", () => {
  assert.equal(trustDecisionLabel(true), "Trust");
  assert.equal(trustDecisionLabel(false), "Block");
  assert.equal(trustDecisionLabel(null), "Remove saved decision");
  assert.equal(trustResourceSummary({ count: 2 }), "2 items");
  assert.equal(trustResourceSummary({ count: 0 }), "Detected");
  assert.equal(shortenTrustPath("/Users/demo/work/pi-web"), "~/work/pi-web");
});
