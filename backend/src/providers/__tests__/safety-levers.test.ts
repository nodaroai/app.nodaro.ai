/**
 * Every provider request that carries a content-filter parameter is declared,
 * and every declared one is what the request actually sends, so a model cannot
 * pick up (or lose) a filter parameter without the admin page knowing.
 *
 * `// @test-watches`: the source reads below.
 */
// @test-watches backend/src/*.ts backend/src/providers/kie/video.ts backend/src/providers/kie/models.ts backend/src/providers/kie/seedance-draft.ts backend/src/providers/replicate/image.ts backend/src/providers/replicate/video.ts backend/src/providers/fal/lip-sync.ts backend/src/providers/nodaro/video.ts backend/src/workers/video-worker.ts
import { describe, expect, it, vi } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

vi.mock("@/lib/translate.js", () => ({ translateToEnglish: vi.fn(async (p: string) => p) }))

import { KIE_IMAGE_MODELS, KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS, kieSafetyEntries } from "../kie/models.js"
import { replicateSafetyEntries } from "../replicate/image.js"
import { falSafetyEntries } from "../fal/lip-sync.js"
import { MODERATION_LEVER, isLeverValue, isLooserThanToday, leverToday, type SafetyLever } from "../safety-levers.js"
import { providerSafetyGroups } from "../safety-entries.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const PROVIDERS = resolve(HERE, "..")

/** A safety parameter's literal, as it appears in a request body or a config. */
const SAFETY_LITERAL = /\b(?:nsfw_checker|enable_safety_checker|disable_safety_checker|safety_tolerance|safetyTolerance)\b/

/** The files that may name one, and why. A new file naming one fails: declare it on the provider's config first. */
const FILES_NAMING_A_SAFETY_PARAM: ReadonlySet<string> = new Set([
  "safety-levers.ts", // the declarations themselves
  "kie/models.ts", // declarations and today's `nsfw_checker: false`
  "kie/video.ts", // Seedance's node option, H3 and Wan never send it
  "kie/seedance-draft.ts", // the finalize carries the draft's own choice
  "replicate/image.ts", // Flux's pinned tolerance and its levers
  "fal/lip-sync.ts", // the lever
])

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === "__tests__" || name === "__characterization__") continue
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

const blankComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")

describe("content-filter parameters in provider code", () => {
  it("only files with a declaration name one", () => {
    const offenders: string[] = []
    for (const abs of sourceFiles(PROVIDERS)) {
      const rel = relative(PROVIDERS, abs).split("\\").join("/")
      if (SAFETY_LITERAL.test(blankComments(readFileSync(abs, "utf8"))) && !FILES_NAMING_A_SAFETY_PARAM.has(rel)) offenders.push(rel)
    }
    expect(offenders, `A provider file sends a safety parameter nothing declares: ${offenders.join(", ")}. Declare it on the provider's config (safetyLevers), then add the file here.`).toEqual([])
  })

  it("a KIE config that sends a filter parameter declares a lever saying so", () => {
    for (const table of [KIE_IMAGE_MODELS, KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS]) {
      for (const [modelId, config] of Object.entries(table)) {
        const sent = config.extraParams?.nsfw_checker
        if (sent === undefined) continue
        const lever = config.safetyLevers?.find((l) => l.param === "nsfw_checker")
        expect(lever, `${modelId} sends nsfw_checker with no lever declared`).toBeDefined()
        expect(lever!.kind === "boolean" ? lever!.shipped : undefined, modelId).toBe(sent)
      }
    }
  })

  it("every declared lever has the shape the setting expects", () => {
    const all: SafetyLever[] = [...kieSafetyEntries(), ...replicateSafetyEntries(), ...falSafetyEntries()].flatMap((e) => e.levers)
    expect(all.length).toBeGreaterThan(50)
    for (const lever of all) {
      if (lever.kind === "boolean") expect(typeof lever.filterOnValue).toBe("boolean")
      else if (lever.kind === "choice") {
        expect(new Set(lever.values).size).toBe(lever.values.length)
        expect(lever.values.length).toBeGreaterThan(1)
      } else {
        expect(lever.min).toBeLessThan(lever.max)
        expect([lever.min, lever.max]).toContain(lever.strictest)
      }
      expect(leverToday(lever)).toBeDefined()
    }
  })

  it("a lever shows as confirmed only on the models a paid test run confirmed it for", () => {
    // Each row: a neutral-prompt run was accepted and finished, and the provider's own record kept the field.
    const CONFIRMED_BY_A_RUN: Record<string, readonly string[]> = {
      "flux-2-klein": ["disable_safety_checker"],
      qwen: ["enable_safety_checker"],
      "seedream-5-lite": ["nsfw_checker"],
      "wan-3": ["nsfw_checker"],
    }
    const confirmed: Record<string, string[]> = {}
    for (const entry of providerSafetyGroups().flatMap((g) => g.entries)) {
      for (const lever of entry.levers) {
        // A lever the request already sends today, or one that can never move, has nothing a run needed to prove.
        if (lever.shipped !== null || lever.neverLoosen || lever.probePending || lever.wireUnconfirmed || lever.kind !== "boolean") continue
        confirmed[entry.modelId] = [...new Set([...(confirmed[entry.modelId] ?? []), lever.param])]
      }
    }
    expect(confirmed).toEqual(CONFIRMED_BY_A_RUN)
  })

  it("Flux Kontext Pro's tolerance is confirmed by a run; Max's is not, so it stays locked", () => {
    const leverOf = (modelId: string) => providerSafetyGroups().flatMap((g) => g.entries).find((e) => e.modelId === modelId)!.levers[0]!
    expect(leverOf("flux-kontext").wireUnconfirmed).toBeUndefined()
    expect(leverOf("flux-kontext-max").wireUnconfirmed).toBe(true)
  })

  it("every process that sends provider requests reads the setting", () => {
    // Read from the entry files themselves, so a new process cannot be left off a list.
    // server.ts and video-director.ts boot through buildApp(), so app.ts covers them.
    const SRC = resolve(PROVIDERS, "..")
    const read = (entry: string): string => readFileSync(resolve(SRC, entry), "utf8")
    const entries = readdirSync(SRC).filter((f) => f.endsWith(".ts") && read(f).includes("registerMainlinePromptPolicies("))
    expect(entries).toEqual(expect.arrayContaining(["app.ts", "worker.ts", "orchestrator.ts", "pipeline-worker.ts", "render-worker.ts", "plugin-daemons.ts"]))
    for (const entry of entries) {
      expect(read(entry), `${entry} never wires the provider-safety setting`).toContain("useProviderSafetySettings()")
    }
  })

  it("the visibility and finalize wiring is in place", () => {
    const worker = readFileSync(resolve(PROVIDERS, "..", "workers", "video-worker.ts"), "utf8")
    expect(worker, "a job must be checked against the models it can run").toContain("providerSafetyEntriesForJob(jobModelIdOf(jobData), { pluginServed: Object.hasOwn(privatePluginHandlers, job.name) })")
    expect(worker, "a loosened run must be forced private at pickup").toMatch(/const loosenedRun = await isLoosenedRun\(/)
    expect(worker, "a loosened run must be forced private at pickup").toMatch(/forcePrivate:[^,\n]*\|\| loosenedRun,/)
  })
})

describe("GPT Image 2.6 moderation", () => {
  it("is declared on Flare and Sunburst, sent as nothing, so KIE's default of low applies", () => {
    for (const id of ["gpt-image-2-6-flare", "gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst", "gpt-image-2-6-sunburst-i2i"]) {
      expect(KIE_IMAGE_MODELS[id]?.safetyLevers).toEqual([MODERATION_LEVER])
      expect(KIE_IMAGE_MODELS[id]?.extraParams?.moderation).toBeUndefined()
    }
    expect(MODERATION_LEVER.shipped).toBeNull()
    expect(leverToday(MODERATION_LEVER)).toBe("low")
  })

  it("Economy documents no such parameter", () => {
    expect(KIE_IMAGE_MODELS["gpt-image-2-6-economy"]?.safetyLevers).toBeUndefined()
    expect(KIE_IMAGE_MODELS["gpt-image-2-6-economy-i2i"]?.safetyLevers).toBeUndefined()
  })

  it("auto is the stricter value, and only the listed values are accepted", () => {
    expect(isLooserThanToday(MODERATION_LEVER, "auto")).toBe(false)
    expect(isLeverValue(MODERATION_LEVER, "auto")).toBe(true)
    expect(isLeverValue(MODERATION_LEVER, "off")).toBe(false)
    expect(isLeverValue(MODERATION_LEVER, true)).toBe(false)
  })
})
