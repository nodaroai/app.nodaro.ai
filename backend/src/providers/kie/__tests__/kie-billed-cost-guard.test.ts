// @test-watches backend/src/providers/kie/video.ts backend/src/providers/kie/audio.ts
/**
 * A KIE video or audio lane records what KIE billed for its task
 * (`jobs.provider_cost`) through ONE rule, `kieBilledCostUsd` (billed-cost.ts):
 * the task record's `creditsConsumed`, else the catalog figure. A branch that
 * returns the catalog figure directly (`cost: modelConfig.cost`, or a variable
 * set to it) records a fixed number, not what the provider billed for the run.
 *
 * Every branch still doing so is listed below by the method that holds it,
 * with how many and why. A new one fails here: route it through
 * `kieBilledCostUsd`, or add it to the list with its reason. The list only
 * shrinks.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const KIE_DIR = join(__dirname, "..")

/** Methods still recording the catalog figure directly, per file: method → how many sites, and why. */
const CATALOG_FIGURE_SITES: Readonly<Record<string, Readonly<Record<string, { count: number; why: string }>>>> = {
  "video.ts": {
    runKling3: { count: 1, why: "Kling 3.0 Video (Image/Text to Video): not a lane of this change" },
    imageToVideo: { count: 3, why: "Image to Video (VEO, Runway, the generic createTask branch): not a lane of this change" },
    textToVideo: { count: 3, why: "Text to Video (VEO, Runway, the generic createTask branch): not a lane of this change" },
    videoToVideo: { count: 1, why: "Runway Aleph: its record-info poll returns only the video's URL (runway-client.ts pollAlephRecordInfo)" },
    lipSyncVideo: { count: 1, why: "Video Lip Sync: not a lane of this change" },
    speechToVideo: { count: 1, why: "Speech to Video: not a lane of this change" },
  },
  "audio.ts": {
    generateMusic: { count: 1, why: "Music: not a lane of this change" },
    textToSpeech: { count: 1, why: "KIE ElevenLabs TTS proxy: not on the live path (ElevenLabs runs direct)" },
    speechToText: { count: 1, why: "KIE ElevenLabs STT proxy: not on the live path (transcription runs Scribe direct)" },
  },
}

/** Methods this rule covers: each calls `kieBilledCostUsd` once per branch it holds. */
const BILLED_COST_SITES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  // Video to Video: Luma Modify, HappyHorse Edit, Wan VideoEdit, and Wan 2.6 + Wan Flash (one shared branch).
  // Motion Transfer: Kling 3.0, Wan Animate Move/Replace (one shared branch), Kling 2.6.
  "video.ts": { videoToVideo: 4, motionTransfer: 3 },
  // Audio Isolation left KIE for ElevenLabs' own API (2026-11-18): no KIE audio lane reads a task's bill now.
  "audio.ts": {},
}

const OWNER = /^(?:export )?(?:async )?function (\w+)|^ {2}async (\w+)\(/
const CATALOG_FIGURE = /\bcost:\s*modelConfig\.cost\b|=\s*modelConfig\.cost\s*$/
const BILLED_COST_CALL = /\bkieBilledCostUsd\(/

function countByOwner(file: string, pattern: RegExp): Record<string, number> {
  const counts: Record<string, number> = {}
  let owner = "(top level)"
  for (const line of readFileSync(join(KIE_DIR, file), "utf8").split("\n")) {
    const m = OWNER.exec(line)
    if (m) owner = (m[1] ?? m[2])!
    if (pattern.test(line) && !line.trimStart().startsWith("import")) counts[owner] = (counts[owner] ?? 0) + 1
  }
  return counts
}

describe("KIE video and audio lanes record the task's bill through kieBilledCostUsd", () => {
  for (const file of Object.keys(CATALOG_FIGURE_SITES)) {
    it(`${file}: only the listed branches record the catalog figure directly`, () => {
      const expected = Object.fromEntries(Object.entries(CATALOG_FIGURE_SITES[file]!).map(([k, v]) => [k, v.count]))
      expect(countByOwner(file, CATALOG_FIGURE)).toEqual(expected)
    })

    it(`${file}: every covered branch reads the task's bill`, () => {
      expect(countByOwner(file, BILLED_COST_CALL)).toEqual(BILLED_COST_SITES[file])
    })
  }
})
