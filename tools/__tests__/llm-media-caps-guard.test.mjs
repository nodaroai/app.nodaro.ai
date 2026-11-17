// tools/__tests__/llm-media-caps-guard.test.mjs
// @test-watches backend/src/** frontend/src/** packages/*/src/**
// The video and audio modality caps (`getLlmModalityCaps(id).video / .audio`,
// `LLM_MODALITY_CAPS[id].video`) say what a model reads ON THE LLM NODES. A
// model can read media there and nowhere else (`LLM_NODE_ONLY_MEDIA_MODELS`,
// Gemini 4 Hydrogen, decided 2026-11-16), so any other product that derives
// "the models that read video" from the caps (Video Analysis, a trend's clip
// step, anything new) must ask `readsVideoOutsideLlmNodes` /
// `readsAudioOutsideLlmNodes` instead — or it silently enrols those models.
//
// This fails a product module (tests excluded) that reads the video or audio
// cap directly, unless it is one of the LLM-node surfaces below.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const root = new URL("../../", import.meta.url)
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean)

/** The LLM-node surfaces, which read the caps as they are, and the predicates' own home. */
const ALLOWED = new Set([
  // The registry: the caps table, the predicates and the Video Analysis list built on them.
  "packages/shared/src/llm-models.ts",
  // LLM Chat's route refuses a video or audio reference its model cannot read.
  "backend/src/routes/llm-chat.ts",
  // LLM Chat's config panel shows the video and audio reference rows.
  "frontend/src/components/editor/config-panels/llm-chat-config.tsx",
])

const SOURCE = /^(?:backend\/src|frontend\/src|packages\/[^/]+\/src)\/.*\.[cm]?[jt]sx?$/
const TEST = /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/

/** Every way a module reads the video or audio cap that this guard knows of. */
export function readsMediaCap(src) {
  if (!/getLlmModalityCaps|LLM_MODALITY_CAPS/.test(src)) return false
  // One level of nested parentheses in the argument (`getLlmModalityCaps(pick(x)).video`).
  if (/getLlmModalityCaps\((?:[^()]|\([^()]*\))*\)\??\.(?:video|audio)\b/.test(src)) return true
  if (/LLM_MODALITY_CAPS\[[^\]]+\]\??\.(?:video|audio)\b/.test(src)) return true
  if (/\{[^}]*\b(?:video|audio)\b[^}]*\}\s*=\s*(?:getLlmModalityCaps\(|LLM_MODALITY_CAPS\[)/.test(src)) return true
  for (const m of src.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:getLlmModalityCaps\(|LLM_MODALITY_CAPS\[)/g)) {
    if (new RegExp(`\\b${m[1]}\\??\\.(?:video|audio)\\b`).test(src)) return true
  }
  return false
}

test("the guard sees each way a module reads the video or audio cap, and nothing else", () => {
  assert.equal(readsMediaCap("getLlmModalityCaps(id).video"), true)
  assert.equal(readsMediaCap("LLM_MODALITY_CAPS[id]?.audio"), true)
  assert.equal(readsMediaCap("getLlmModalityCaps(pick(x)).video"), true)
  assert.equal(readsMediaCap("const { video } = getLlmModalityCaps(id)"), true)
  assert.equal(readsMediaCap("const caps = getLlmModalityCaps(id)\nif (caps.audio) x()"), true)
  assert.equal(readsMediaCap("const caps = getLlmModalityCaps(id)\nif (caps.image) x()"), false)
  assert.equal(readsMediaCap("readsVideoOutsideLlmNodes(id) && getLlmModalityCaps(id).image"), false)
  assert.equal(readsMediaCap("block.video"), false)
})

test("only the LLM-node surfaces read the video/audio cap directly; every other product asks readsVideoOutsideLlmNodes", () => {
  const offenders = tracked
    .filter((f) => SOURCE.test(f) && !TEST.test(f) && !ALLOWED.has(f))
    .filter((f) => readsMediaCap(readFileSync(new URL(f, root), "utf8")))
  assert.deepEqual(offenders, [], "read the cap through readsVideoOutsideLlmNodes / readsAudioOutsideLlmNodes (@nodaro/shared/llm-models), or add an LLM-node surface to ALLOWED with why")
})

test("every allowed surface still reads the cap (a stale entry is removed)", () => {
  for (const f of ALLOWED) assert.equal(readsMediaCap(readFileSync(new URL(f, root), "utf8")), true, f)
})

// The `file` cap (documents, PDF) is the LLM nodes' too: Gemini 4 Hydrogen
// reads files there (decided 2026-11-17) and is enrolled in nothing else. A
// product module that asks "does this model read files" outside the LLM-node
// surfaces below would enrol it.
const FILE_ALLOWED = new Set([
  "packages/shared/src/llm-models.ts",
  // The package entry that re-exports them.
  "packages/shared/src/entries/llm-models.ts",
  // LLM Chat's route refuses a file on a model that reads none, and readies files for the model's lane.
  "backend/src/routes/llm-chat.ts",
  // LLM Chat's config panel shows the Files (PDF) rows.
  "frontend/src/components/editor/config-panels/llm-chat-config.tsx",
  // The lanes an LLM call is served on: each sends a file in the shape the model declares for it (`fileWire`).
  "backend/src/lib/llm/message-builders.ts",
  "backend/src/lib/gemini/client.ts",
  // Whether the aggregator can take over a call built for the vendor's own API: only with its files in the declared shape.
  "backend/src/lib/llm/exhaustion-fallback.ts",
])

/** `src` without its comments (roughly: block comments, and line comments that start a line or follow a space). */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1")
}

/** Every way a module asks whether a model reads files that this guard knows of. */
export function readsFileCap(src) {
  const c = code(src)
  if (/\b(?:llmAcceptsFiles|llmFileWire|LLM_FILE_MODELS)\b/.test(c)) return true
  if (/\.fileWire\b/.test(c)) return true
  if (/getLlmModalityCaps\((?:[^()]|\([^()]*\))*\)\??\.file\b/.test(c)) return true
  if (/LLM_MODALITY_CAPS\[[^\]]+\]\??\.file\b/.test(c)) return true
  if (/\{[^}]*\bfile\b[^}]*\}\s*=\s*(?:getLlmModalityCaps\(|LLM_MODALITY_CAPS\[)/.test(c)) return true
  for (const m of c.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:getLlmModalityCaps\(|LLM_MODALITY_CAPS\[)/g)) {
    if (new RegExp(`\\b${m[1]}\\??\\.file\\b`).test(c)) return true
  }
  return false
}

test("the guard sees each way a module asks whether a model reads files", () => {
  assert.equal(readsFileCap("if (llmAcceptsFiles(id)) x()"), true)
  assert.equal(readsFileCap("llmFileWire(id)?.kie"), true)
  assert.equal(readsFileCap("for (const m of LLM_FILE_MODELS) x(m)"), true)
  assert.equal(readsFileCap("model.fileWire?.direct"), true)
  assert.equal(readsFileCap("getLlmModalityCaps(id).file"), true)
  assert.equal(readsFileCap("LLM_MODALITY_CAPS[id]?.file"), true)
  assert.equal(readsFileCap("const { file } = getLlmModalityCaps(id)"), true)
  assert.equal(readsFileCap("const caps = getLlmModalityCaps(id)\nif (caps.file) x()"), true)
  assert.equal(readsFileCap("const caps = getLlmModalityCaps(id)\nif (caps.image) x()"), false)
  assert.equal(readsFileCap("// only a model that reads files (`llmAcceptsFiles`)"), false)
  assert.equal(readsFileCap("/** see `LlmModelDef.fileWire` and llmAcceptsFiles */\nx()"), false)
  assert.equal(readsFileCap("upload.file.name"), false)
})

test("only the LLM-node surfaces ask whether a model reads files", () => {
  const offenders = tracked
    .filter((f) => SOURCE.test(f) && !TEST.test(f) && !FILE_ALLOWED.has(f))
    .filter((f) => readsFileCap(readFileSync(new URL(f, root), "utf8")))
  assert.deepEqual(offenders, [], "a model's `file` cap is for the LLM nodes: add an LLM-node surface to FILE_ALLOWED with why, or do not read it")
})

test("every allowed file surface still asks (a stale entry is removed)", () => {
  for (const f of FILE_ALLOWED) assert.equal(readsFileCap(readFileSync(new URL(f, root), "utf8")), true, f)
})
