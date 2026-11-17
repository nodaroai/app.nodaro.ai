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
