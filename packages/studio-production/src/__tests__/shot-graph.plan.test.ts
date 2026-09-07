import { describe, it, expect } from "vitest"
import type { Workflow } from "@nodaro/sdk"

import { parseProduction, serializeProduction } from "../shot-graph"
import type { Shot } from "../shot"
import type { ScenePlan } from "../scene-plan"
import { toRecipeOnlyShot } from "../bundle/production-bundle-strip"

/**
 * A scene's PLAN rides the same persistence spine as its beats and its look, so
 * a reload, a clipboard paste and the recycle bin all carry it for free.
 * (Duplicate does NOT — `cloneShot` rebuilds a shot field by field and already
 * drops `look` and `beats` today.) Two things must hold: a plan-less production
 * keeps saving exactly the bytes it saves today, and a plan survives the round
 * trip whole — including a SECOND save after a reload.
 */
const stillOnly: Shot = {
  id: "shot-a",
  still: {
    nodeId: "generate-image-job1",
    url: "https://r2.example/still-a.png",
    provider: "gpt-image-2",
    prompt: "a knight on a hill",
  },
}

/** `Required<ScenePlan>`, deliberately (D4/R38-6): the plan carries EVERY stage
 *  the type has, so a FOURTH stage breaks compilation here — the guard below
 *  then makes `copyPlan` and the recipe projection prove they carry it. */
const plan: Required<ScenePlan> = {
  frame: {
    prompt: "@Natalie sprints down a narrow Roman alley",
    negativePrompt: "blurry, washed out",
    provider: "gpt-image-2",
    aspectRatio: "16:9",
    resolution: "2K",
    count: 2,
    references: [
      {
        id: "c1",
        defaultName: "Natalie",
        source: "wired-character",
        url: "https://r2.example/natalie.png",
      },
    ],
    referenceImageUrls: ["https://r2.example/mood-board.png"],
    // The Structured Subject picks: a multi dimension's ARRAY, which a spread
    // alone would alias (R35).
    subject: { ethnicity: ["asian-any", "east-asian"], type: "woman" },
  },
  motion: {
    prompt: "slow push [drums]",
    negativePrompt: "camera shake",
    provider: "seedance-2",
    duration: 10,
    cameraMotionId: "tracking-shot",
    references: [
      {
        id: "l1",
        defaultName: "Roman alley",
        source: "wired-location",
        url: "https://r2.example/alley.png",
      },
    ],
    // Last, as `readMotion` rebuilds it — the byte-identity test above pins
    // the save→reload→save pairing, key order included.
    directions: [{ kind: "music", text: "drums" }],
  },
  // The THIRD stage (plan-import-v2 D4, fix round 1 R38-6) — `copyPlan`
  // dropped this stage entirely until the fix, so every persistence path
  // (save, reload, clipboard, bundle) silently destroyed an imported
  // voiceover plan on the very first write.
  voice: {
    text: "Go now",
    casting: "male, urgent",
    voiceId: "rachel-1",
    voiceType: "premade",
    ttsProvider: "elevenlabs-v3",
    model: "eleven_v3",
    delivery: { speed: 1.1, stability: 0.6 },
  },
}

const planned: Shot = { ...stillOnly, id: "shot-p", plan }

/** Wrap a serialized production as the Workflow the loader hands back. */
function workflowOf(shots: ReadonlyArray<Shot>, studioOverride?: object): Workflow {
  const base = serializeProduction(shots, shots[0]?.id)
  return {
    id: "wf-1",
    projectId: "p-1",
    userId: "u-1",
    name: "Production",
    nodes: base.nodes,
    edges: base.edges,
    settings: {
      studio: { ...(base.settings.studio as object), ...(studioOverride ?? {}) },
    },
    createdAt: "2026-08-30T00:00:00Z",
    updatedAt: "2026-08-30T00:00:00Z",
  } as unknown as Workflow
}

describe("shot plan — persistence", () => {
  it("writes NO plan key for a plan-less scene", () => {
    const entry = serializeProduction([stillOnly], "shot-a").settings.studio.shots[0]
    expect("plan" in entry).toBe(false)
  })

  it("a plan-less production serializes byte-identically after a reload", () => {
    const first = serializeProduction([stillOnly], "shot-a")
    const reloaded = parseProduction(workflowOf([stillOnly]))
    const second = serializeProduction(reloaded.shots, reloaded.selectedShotId)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it("round-trips a plan through save + reload", () => {
    expect(parseProduction(workflowOf([planned])).shots[0].plan).toEqual(plan)
  })

  it("a plan-carrying production re-serializes to the same bytes after a reload", () => {
    // Serialize copies by SPREAD and parse ENUMERATES, so the two can disagree.
    // This pins the pairing for the shapes the store actually holds: what a save
    // writes must survive a reload and come back out identical.
    const first = serializeProduction([planned], "shot-p")
    const reloaded = parseProduction(workflowOf([planned]))
    const second = serializeProduction(reloaded.shots, reloaded.selectedShotId)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it("copies the plan — the index never aliases the store's object", () => {
    const entry = serializeProduction([planned], "shot-p").settings.studio.shots[0]
    expect(entry.plan).toEqual(plan)
    expect(entry.plan).not.toBe(planned.plan)
    expect(entry.plan?.frame?.references).not.toBe(planned.plan?.frame?.references)
    // Every array copyPlan re-copies, not just the first: each of these is a
    // separate branch, and a spread alone would alias them all.
    expect(entry.plan?.frame?.referenceImageUrls).not.toBe(
      planned.plan?.frame?.referenceImageUrls,
    )
    expect(entry.plan?.motion?.references).not.toBe(planned.plan?.motion?.references)
    expect(entry.plan?.motion?.directions).not.toBe(planned.plan?.motion?.directions)
    expect(entry.plan?.voice).not.toBe(planned.plan?.voice)
    expect(entry.plan?.voice?.delivery).not.toBe(planned.plan?.voice?.delivery)
    expect(entry.plan?.frame?.subject).toEqual(plan.frame.subject)
    expect(entry.plan?.frame?.subject).not.toBe(planned.plan?.frame?.subject)
    expect(entry.plan?.frame?.subject?.ethnicity).not.toBe(plan.frame.subject?.ethnicity)
  })

  it("carries EVERY ScenePlan stage through copyPlan and the recipe projection", () => {
    // The fixture is `Required<ScenePlan>`, so the next stage cannot compile
    // until it is listed; this then proves both copy paths carry it, and that
    // neither hands back the store's own object (the R38-6 class: `copyPlan`
    // dropped `voice` whole, `untokenizeRecipeProse` passed it by reference).
    const stages = Object.keys(plan) as Array<keyof ScenePlan>
    expect(stages.length).toBeGreaterThan(2)

    const copied = serializeProduction([planned], "shot-p").settings.studio.shots[0].plan
    for (const stage of stages) {
      expect(copied?.[stage], `${stage} dropped by copyPlan`).toBeDefined()
      expect(copied?.[stage], `${stage} aliases the store`).not.toBe(plan[stage])
    }

    // The recipe-only projection SUBTRACTS media, so the stages are not equal
    // to the source — they must simply all be there, and all be fresh.
    const recipeOnly = toRecipeOnlyShot(planned, { roleNames: ["Natalie"] })
    for (const stage of stages) {
      expect(recipeOnly.plan?.[stage], `${stage} dropped by the recipe`).toBeDefined()
      expect(recipeOnly.plan?.[stage], `${stage} aliases the shot`).not.toBe(plan[stage])
    }
  })

  it("drops a malformed plan instead of throwing", () => {
    const base = serializeProduction([stillOnly], "shot-a")
    const shots = [{ ...base.settings.studio.shots[0], plan: "nonsense" }]
    const wf = workflowOf([stillOnly], { shots })
    expect(() => parseProduction(wf)).not.toThrow()
    expect(parseProduction(wf).shots[0].plan).toBeUndefined()
  })
})
