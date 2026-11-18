// @test-watches backend/src/**
/**
 * A model the provider bills by RUN TIME must be charged by something that
 * grows with that run time (decided 2026-11-18).
 *
 * LatentSync was listed in the GPU-time rate table — the provider's bill grows
 * with every second it runs — while a run was charged one fixed row whatever
 * the clip's length, and committed that row whatever the run cost. A long clip
 * was charged a fraction of what it cost, and nothing compared the two.
 *
 * Two declarations hold the rule, and a new model or a new call site fails
 * here until it states how it is charged:
 *
 *  1. every model in the GPU-time rate table (`REPLICATE_MODEL_USD_PER_SEC`);
 *  2. every file that runs a Replicate prediction (`runReplicatePrediction`).
 *
 * `fixed-row` is the burn-down list: models still charged one row for work the
 * caller sizes. It only shrinks — fix one, move it to the shape it now has.
 * Never add to it to make this test pass: charge the new model by its run's
 * cost (`isLipSyncChargedAtRunCost` is the lip-sync precedent), by a length the
 * server measures and caps, or by the units the provider reports.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { REPLICATE_MODEL_USD_PER_SEC } from "../client.js"
import { isLipSyncChargedAtRunCost, isPerSecondLipSyncProvider } from "@nodaro/shared/credits"
import { retiredLipSyncProviderName } from "@nodaro/shared/models"

type Charge =
  /** The provider's cost for the run is the charge (a hold, settled up or down). */
  | "run-cost"
  /** No longer runs: its route refuses it. */
  | "retired"
  /** One fixed row for work the caller sizes. The burn-down list. */
  | "fixed-row"

const RATE_TABLE_MODELS: Readonly<Record<string, { charge: Charge; why: string }>> = {
  latentsync: { charge: "run-cost", why: "held by its audio's length bucket, settled at the run's cost" },
  wav2lip: { charge: "retired", why: "retired from Lip Sync 2026-11-12" },
  sadtalker: { charge: "retired", why: "retired from Lip Sync 2026-11-12" },
  "video-retalking": { charge: "retired", why: "retired from Lip Sync 2026-11-12" },
  "incredibly-fast-whisper": { charge: "fixed-row", why: "Transcribe: one row whatever the recording's length" },
  whisper: { charge: "fixed-row", why: "Transcribe: one row whatever the recording's length" },
  demucs: { charge: "fixed-row", why: "Separate Audio: one row per mode whatever the audio's length" },
}

/** How each file that runs a Replicate prediction is charged for the time the prediction takes. */
const PREDICTION_CALL_SITES: Readonly<Record<string, { charge: "bounded" | "by-length" | "by-units" | "per-model" | "fixed-row"; why: string }>> = {
  "providers/replicate/client.ts": { charge: "bounded", why: "the definition itself" },
  "providers/replicate/image.ts": { charge: "bounded", why: "one image per run; size and reference tiers are price rows" },
  "providers/replicate/video.ts": { charge: "bounded", why: "duration and resolution are enums, each a price row" },
  "providers/replicate/lip-sync.ts": { charge: "per-model", why: "RATE_TABLE_MODELS above; the dubbing models hold a measured audio bucket" },
  "providers/replicate/video-depth.ts": { charge: "by-length", why: "a bucket of the measured clip length, capped" },
  "providers/replicate/topaz.ts": { charge: "by-units", why: "settled on the units the provider reports" },
  "providers/replicate/audio-separation.ts": { charge: "fixed-row", why: "Demucs: one row per mode whatever the audio's length" },
  "providers/replicate/face-swap.ts": { charge: "fixed-row", why: "one row whatever the target video's length" },
}

const SRC = join(__dirname, "..", "..", "..")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path)
    return /\.ts$/.test(name) && !/\.(test|d)\.ts$/.test(name) ? [path] : []
  })
}

describe("a model billed by run time is charged by something that grows with it", () => {
  it("every model in the GPU-time rate table states how it is charged", () => {
    expect(Object.keys(REPLICATE_MODEL_USD_PER_SEC).sort()).toEqual(Object.keys(RATE_TABLE_MODELS).sort())
  })

  it("a model declared as charged at its run's cost really is, and holds a length bucket", () => {
    for (const [model, { charge }] of Object.entries(RATE_TABLE_MODELS)) {
      if (charge !== "run-cost") continue
      expect(isLipSyncChargedAtRunCost(model), model).toBe(true)
      expect(isPerSecondLipSyncProvider(model), model).toBe(true)
    }
  })

  it("a model declared retired is refused by its route", () => {
    for (const [model, { charge }] of Object.entries(RATE_TABLE_MODELS)) {
      if (charge === "retired") expect(retiredLipSyncProviderName(model), model).toBeDefined()
    }
  })

  it("every file that runs a Replicate prediction states how it is charged", () => {
    const callers = sourceFiles(SRC)
      .filter((file) => /\brunReplicatePrediction\s*\(/.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file).split("\\").join("/"))
      .sort()
    expect(callers).toEqual(Object.keys(PREDICTION_CALL_SITES).sort())
  })

  it("the fixed-row list only shrinks", () => {
    const fixedRow = [
      ...Object.entries(RATE_TABLE_MODELS).filter(([, v]) => v.charge === "fixed-row").map(([k]) => k),
      ...Object.entries(PREDICTION_CALL_SITES).filter(([, v]) => v.charge === "fixed-row").map(([k]) => k),
    ].sort()
    expect(fixedRow).toEqual([
      "demucs",
      "incredibly-fast-whisper",
      "providers/replicate/audio-separation.ts",
      "providers/replicate/face-swap.ts",
      "whisper",
    ])
  })
})
