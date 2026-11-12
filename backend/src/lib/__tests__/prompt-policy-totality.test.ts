import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { unitRouteFiles } from "../unit-source-files.js"

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
 *
 * The PLUGIN lane (Cloud plugins: the gvp/evp pipelines, Nodaro Motion,
 * trends) assembles its prompts in the private plugin package, which this
 * repo cannot scan. Its door into the same registry is the toolkit member
 * `tk.prompts.applyPolicies` (`lib/private-plugins/toolkit.ts`), which runs
 * `applyPromptPolicies` at call time; half (d) pins that wiring here. Whether
 * every plugin provider dispatch actually calls it is enforced by the plugin
 * repo's own totality test, never by this file. A plugin prompt that goes on
 * through `tk.http.internalRequest` to a core route is policed again there,
 * which the policy author's idempotence contract makes a no-op.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ROUTES = resolve(HERE, "..", "..", "routes")
const WORKERS = resolve(HERE, "..", "..", "workers", "handlers")
const ENGINE = resolve(HERE, "..", "..", "services", "workflow-engine")
const SRC = resolve(HERE, "..", "..")
/** A route by its label here: a basename under routes/, or a node unit's route as nodes/<type>/route.ts. */
const routePath = (label: string): string => (label.startsWith("nodes/") ? resolve(SRC, label) : resolve(ROUTES, label))
/** Every route this guard classifies: the routes/ files, plus every node unit's route. */
const routeLabels = (): string[] => [
  ...readdirSync(ROUTES).filter((f) => f.endsWith(".ts") && !f.endsWith(".schema.ts")),
  ...unitRouteFiles(resolve(SRC, "..", "..")).map((f) => f.slice(SRC.length + 1).split("\\").join("/")),
]

/** Routes whose assembly point polices IN THE ROUTE FILE (checked by (a)). */
const HOOKED_ROUTES: readonly string[] = [
  // image
  // generate-image assembles each job's prompt in its planner module (one per
  // model of a fan-out); the route file itself holds no prompt schema.
  "generate-image-plan.ts",
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
  "video-mask.ts": "prompt is a SEGMENTATION TARGET (SAM 3 video) — a policy clause would corrupt masking",
  "nodes/split-into-layers/route.ts": "prompt is a SEGMENTATION TARGET (which elements of the image to split into layers) — a policy clause would corrupt the split",
  "generate-face.ts": "polices at the entity image chokepoint (workers/handlers/entity.ts makeEntityImageHandler)",
  "generate-music.ts": "polices at the music assembly point (workers/handlers/suno.ts)",
  "suno.ts": "voice-persona routes; every music prompt assembles + polices in workers/handlers/suno.ts",
  "pipelines.ts": "film-studio pipeline — assembly lives in the Cloud plugin lane, which polices through tk.prompts.applyPolicies (half (d))",
  "after-effects-ai.ts": "LLM plan lane — structured output, not a media-generation prompt",
  "generate-script.ts": "LLM lane — script text, not a media-generation prompt",
  "image-critic.ts": "LLM analysis lane",
  "lottie-overlay-ai.ts": "LLM plan lane",
  "motion-graphics-ai.ts": "LLM plan lane",
  "prompt-helper.ts": "LLM lane — the user edits the result; generation lanes police downstream",
  "scene-graph-ai.ts": "LLM lane",
  "three-d-title-ai.ts": "LLM plan lane",
  // Scene3D previz: the brief authors a STRUCTURED SCENE GRAPH (primitives,
  // transforms, keyframes), never a prompt sent to an image/video provider.
  // A modesty clause spliced into it would be corruption, exactly as for the
  // other plan lanes above — and the rendered MP4 that eventually leaves the
  // platform is a Remotion render of grey-box geometry, with no generative
  // prompt anywhere in its lineage.
  "3d-scene.ts": "LLM plan lane — authors a scene graph, not a media-generation prompt",
}

/** The same heuristic the exhaustiveness half scans with: a zod prompt-ish
 *  field AND a job insert / queue add in one route file. */
function isCandidate(src: string): boolean {
  return /(?:\bprompt|voiceDescription)\s*:\s*z\./.test(src) && /(?:insertJob\w*\(|Queue\.add\()/.test(src)
}

describe("prompt-policy totality — every media-prompt lane polices at its assembly point", () => {
  it("(a) every HOOKED route file actually calls applyPromptPolicies", () => {
    for (const f of HOOKED_ROUTES) {
      const src = readFileSync(routePath(f), "utf8")
      expect(src.includes("applyPromptPolicies("), `${f} is classified HOOKED but never calls applyPromptPolicies`).toBe(true)
    }
  })

  it("(b) exhaustiveness: every candidate route is classified exactly once", () => {
    const hooked = new Set(HOOKED_ROUTES)
    const excluded = new Set(Object.keys(EXCLUDED_ROUTES))
    for (const f of hooked) expect(excluded.has(f), `${f} appears in BOTH lists`).toBe(false)

    const unclassified: string[] = []
    for (const f of routeLabels()) {
      const src = readFileSync(routePath(f), "utf8")
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

  it("(d) the plugin lane's toolkit door runs the same registry", () => {
    // The member a plugin calls at its own assembly point. It must DELEGATE to
    // the registry (read at call time), never carry a copy of a policy.
    // Behaviour is proven in private-plugins/__tests__/toolkit-prompt-policy.test.ts.
    const toolkit = readFileSync(resolve(SRC, "lib", "private-plugins", "toolkit.ts"), "utf8")
    expect(toolkit, "toolkit.ts no longer wires tk.prompts.applyPolicies to the prompt funnel").toMatch(
      /prompts:\s*\{\s*applyPolicies:\s*\([^)]*\)\s*=>\s*policeForPlugin\(/,
    )
    const police = toolkit.slice(toolkit.indexOf("function policeForPlugin("), toolkit.indexOf("\n}\n", toolkit.indexOf("function policeForPlugin(")))
    expect(police, "policeForPlugin no longer delegates to applyPromptPolicies").toMatch(/applyPromptPolicies\(\{ \.\.\.assembly \}\)/)
    const contract = readFileSync(resolve(SRC, "lib", "private-plugins", "types.ts"), "utf8")
    expect(contract, "types.ts no longer declares the tk.prompts group").toMatch(/\bprompts\?:\s*PluginPromptsToolkit\b/)
    // Plugin music: the plugin polices its music prompt ONCE, at its own
    // boundary, and hands the policy's vocal gender and negative style to the
    // toolkit's music member, which FORWARDS them to the provider and runs no
    // policy of its own — so nothing is policed twice. Behaviour is proven in
    // private-plugins/__tests__/toolkit-music-gen.test.ts.
    const musicAt = toolkit.indexOf("async function pluginGenerateMusic(")
    expect(musicAt, "toolkit.ts no longer has the plugin music member").toBeGreaterThan(0)
    const music = toolkit.slice(musicAt, toolkit.indexOf("\n}\n", musicAt))
    expect(music, "the plugin music member no longer forwards a policed vocal gender").toMatch(/options\?\.vocalGender \? \{ vocalGender: options\.vocalGender \} : \{\}/)
    expect(music, "the plugin music member no longer forwards a policed negative style").toMatch(/options\?\.negativeStyle \? \{ negativeStyle: options\.negativeStyle \} : \{\}/)
    expect(music, "the plugin music member runs a policy itself: a plugin's music prompt would be policed twice").not.toMatch(/applyPromptPolicies\(/)
    const musicOptions = contract.slice(contract.indexOf("export interface PluginMusicGenOptions"), contract.indexOf("export interface PluginMusicGenResult"))
    expect(musicOptions, "PluginMusicGenOptions no longer takes the policy's vocal gender and negative style").toMatch(/vocalGender\?: string[\s\S]*negativeStyle\?: string/)
  })
})
