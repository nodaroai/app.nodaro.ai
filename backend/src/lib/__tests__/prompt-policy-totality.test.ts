import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Prompt-policy totality guard (B4b). The deployment PromptPolicy seam is only
 * a guarantee if EVERY media-generation prompt passes through
 * `applyPromptPolicies` at its assembly point — the place the final prompt
 * text is determined before dispatch (a route for user-final prompts, a worker
 * for worker-assembled ones, payload-builder for the DAG). Hooking only some
 * sites re-opens the "server is the authority" hole for the unhooked lanes.
 *
 * Mechanism (mirrors prompt-affixes-totality + the orphan guard): an explicit
 * classification table over every prompt-carrying job-creating route, with two
 * enforcement halves —
 *   (a) every HOOKED file really contains the applyPromptPolicies call, and
 *   (b) exhaustiveness: every route the candidate heuristic finds (a zod
 *       prompt-ish field + a job insert / queue add) is classified, so a new
 *       media route can't ship unhooked without a conscious entry here.
 *
 * Excluded lanes carry their reason IN the table: a prompt that is not a
 * media-generation prompt (segmentation targets, LLM/plan lanes, spoken TTS
 * content) must NOT be policed — a modesty clause inside a mask target or a
 * structured-output system prompt is corruption, not enforcement.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ROUTES = resolve(HERE, "..", "..", "routes")
const WORKERS = resolve(HERE, "..", "..", "workers", "handlers")
const ENGINE = resolve(HERE, "..", "..", "services", "workflow-engine")

/** Routes whose assembly point polices IN THE ROUTE FILE (checked by (a)). */
const HOOKED_ROUTES: readonly string[] = [
  // image
  "generate-image.ts",
  "image-to-image.ts",
  "edit-image.ts",
  "generate-surround-continuation.ts",
  "reference-board.ts",
  // video
  "generate-video.ts",
  "text-to-video.ts",
  "generate-character-motion.ts",
  "generate-creature-motion.ts",
  "generate-location-motion.ts",
  "generate-object-motion.ts",
  "extend-video.ts",
  "motion-transfer.ts",
  "cinematic-avatar.ts",
  "speech-to-video.ts",
  "switchx.ts",
  "video-retake.ts",
  "video-to-video.ts",
  "lip-sync.ts",
  // audio (generative descriptions — the deployment's policy no-ops on audio
  // prompts by design; the hook is the totality guarantee for future policies)
  "text-to-audio.ts",
  "video-sfx.ts",
  "voice-design.ts",
  "voice-remix.ts",
]

/** Candidate routes that must NOT police in the route, with the reason. */
const EXCLUDED_ROUTES: Readonly<Record<string, string>> = {
  "generate-mask.ts": "prompt is a SEGMENTATION TARGET — a policy clause would corrupt masking",
  "generate-face.ts": "polices at the entity image chokepoint (workers/handlers/entity.ts makeEntityImageHandler)",
  "generate-music.ts": "polices at the music assembly point (workers/handlers/suno.ts)",
  "suno.ts": "voice-persona routes; every music prompt assembles + polices in workers/handlers/suno.ts",
  "pipelines.ts": "film-studio pipeline — assembly lives in the Cloud plugin lane (documented gvp/evp caveat)",
  "after-effects-ai.ts": "LLM plan lane — structured output, not a media-generation prompt",
  "generate-script.ts": "LLM lane — script text, not a media-generation prompt",
  "image-critic.ts": "LLM analysis lane",
  "lottie-overlay-ai.ts": "LLM plan lane",
  "motion-graphics-ai.ts": "LLM plan lane",
  "prompt-helper.ts": "LLM lane — the user edits the result; generation lanes police downstream",
  "scene-graph-ai.ts": "LLM lane",
  "three-d-title-ai.ts": "LLM plan lane",
}

/** The same heuristic the exhaustiveness half scans with: a zod prompt-ish
 *  field AND a job insert / queue add in one route file. */
function isCandidate(src: string): boolean {
  return /(?:\bprompt|voiceDescription)\s*:\s*z\./.test(src) && /(?:insertJob\w*\(|Queue\.add\()/.test(src)
}

describe("prompt-policy totality — every media-prompt lane polices at its assembly point", () => {
  it("(a) every HOOKED route file actually calls applyPromptPolicies", () => {
    for (const f of HOOKED_ROUTES) {
      const src = readFileSync(resolve(ROUTES, f), "utf8")
      expect(src.includes("applyPromptPolicies("), `${f} is classified HOOKED but never calls applyPromptPolicies`).toBe(true)
    }
  })

  it("(b) exhaustiveness: every candidate route is classified exactly once", () => {
    const hooked = new Set(HOOKED_ROUTES)
    const excluded = new Set(Object.keys(EXCLUDED_ROUTES))
    for (const f of hooked) expect(excluded.has(f), `${f} appears in BOTH lists`).toBe(false)

    const unclassified: string[] = []
    for (const f of readdirSync(ROUTES).filter((f) => f.endsWith(".ts") && !f.endsWith(".schema.ts"))) {
      const src = readFileSync(resolve(ROUTES, f), "utf8")
      if (!isCandidate(src)) continue
      if (!hooked.has(f) && !excluded.has(f)) unclassified.push(f)
    }
    // A new media route must be consciously classified: hook it at its
    // assembly point and list it in HOOKED_ROUTES, or record WHY it must not
    // be policed in EXCLUDED_ROUTES.
    expect(unclassified, `unclassified prompt-carrying routes: ${unclassified.join(", ")}`).toEqual([])
  })

  it("(c) the worker + DAG assembly chokepoints police", () => {
    // Entity images (all four entity types + faces, main + assets) and Suno
    // music assemble in their workers; the DAG assembles in payload-builder.
    expect(readFileSync(resolve(WORKERS, "entity.ts"), "utf8").includes("applyPromptPolicies(")).toBe(true)
    expect(readFileSync(resolve(WORKERS, "suno.ts"), "utf8").includes("applyPromptPolicies(")).toBe(true)
    const pb = readFileSync(resolve(ENGINE, "payload-builder.ts"), "utf8")
    expect(pb.includes("withImagePromptPolicy")).toBe(true)
    expect(pb.includes("applyPromptPolicies(")).toBe(true)
  })
})
