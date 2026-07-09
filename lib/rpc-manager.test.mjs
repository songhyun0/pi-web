import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createAgentSessionServices\(/);
  assert.match(startupSource, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startupSource, /await createAgentSession\(/);
});

test("Fast mode is not restored through hidden slash-command prompts", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const promptCaseSource = source.slice(
    source.indexOf('case "prompt"'),
    source.indexOf('case "abort"')
  );

  assert.doesNotMatch(promptCaseSource, /\/fast/);
  assert.doesNotMatch(source, /applyRememberedOpenAIFastPreference/);
});
