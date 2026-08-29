/**
 * Source-level guard for the frontend executor's Category-B prompt-read sites
 * (spec §5.2). `executeNode` is a 8k-line dispatcher that calls live APIs, so the
 * per-type marker test lives on the backend (`prompt-affixes-totality.test.ts`);
 * here we assert each bespoke `if (node.type === "<type>")` block wraps its
 * prompt with `applyPromptAffixes(` so a new/edited site can't silently drop it.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = readFileSync(join(__dirname, "..", "execute-node.ts"), "utf8")

/** Category B on the frontend (Category A goes through promptOf / assembleVideoPrompt / computeLlmChatFields). */
const CATEGORY_B = [
  "modify-image", "generate-mask", "voice-remix", "voice-design", "forced-alignment", "video-analysis",
  "suno-generate", "suno-cover", "suno-extend", "suno-lyrics", "suno-style-boost", "suno-upload-extend",
  "image-to-text", "lip-sync", "motion-transfer", "video-sfx", "3d-title", "motion-graphics", "image-critic",
  "generate-script",
]

function blockFor(type: string): string {
  const start = SRC.indexOf(`if (node.type === "${type}")`)
  expect(start, `no dispatch block for ${type}`).toBeGreaterThan(-1)
  const next = SRC.indexOf("\n  if (node.type === \"", start + 1)
  return SRC.slice(start, next === -1 ? undefined : next)
}

describe("execute-node Category-B sites wrap the prompt with applyPromptAffixes", () => {
  for (const type of CATEGORY_B) {
    it(type, () => expect(blockFor(type)).toContain("applyPromptAffixes("))
  }
})
