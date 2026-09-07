/**
 * The `shots` section's listing, completed — three studio describes SECTIONS.md
 * §3 names among this section's port that no `shots` OPERATION can reach.
 *
 * They exercise the `stills`, `clips` and `trash` handlers. Rather than drop
 * them (rule 1 — an assertion that cannot survive is reported, never omitted)
 * they are ported here, against those handlers, so §3's list has no silent
 * hole. Those sections own the behaviour; this file owns the fact that it was
 * checked.
 */
import { beforeEach, describe, expect, it } from "vitest"

import type { Production } from "../production"
import type { OpContext } from "../types"
import { parseProduction, serializeProduction } from "../../shot-graph"
import type { Shot } from "../../shot"
import { clipsHandlers } from "../sections/clips"
import { stillsHandlers } from "../sections/stills"
import { trashHandlers } from "../sections/trash"

// ── fixtures (copied from the studio suite so the assertions read the same) ──

/** A still-only shot fixture (stable ids for assertions). */
const stillOnly = (id: string): Shot => ({
  id,
  still: {
    nodeId: `generate-image-${id}`,
    url: `https://r2.example/${id}.png`,
    provider: "nano-banana",
    prompt: `prompt ${id}`,
  },
})

/** A still+clip shot fixture. */
const stillAndClip = (id: string): Shot => ({
  ...stillOnly(id),
  clip: {
    nodeId: `generate-video-${id}`,
    url: `https://r2.example/${id}.mp4`,
    provider: "grok-i2v",
    prompt: `clip ${id}`,
    duration: 5,
  },
})

/** A production over `shots`, selecting `selectedShotId` — the store's own
 *  `setShots` selection rule (keep it if it survives, else the first shot). */
const prod = (
  shots: ReadonlyArray<Shot>,
  selectedShotId?: string,
  extra?: Partial<Production>,
): Production => ({
  shots: [...shots],
  selectedShotId:
    selectedShotId && shots.some((s) => s.id === selectedShotId)
      ? selectedShotId
      : shots[0]?.id,
  ...extra,
})

let minted: number
const ctx: OpContext = {
  now: "2026-09-06T12:00:00.000Z",
  mintId: () => `minted-${++minted}`,
}

beforeEach(() => {
  minted = 0
})

describe("a scene PLAN survives rendering (production-store.test.ts L1673)", () => {
  /** An imported, never-rendered scene: no still, no clip, just its plan. */
  const planned = (): Shot => ({
    id: "p1",
    plan: {
      frame: {
        prompt: "@Natalie sprints down a narrow Roman alley",
        provider: "gpt-image-2",
        aspectRatio: "16:9",
        count: 2,
      },
      motion: { provider: "seedance-2", duration: 10, cameraMotionId: "tracking-shot" },
    },
  })

  it("keeps the plan when the first still lands", () => {
    const { production } = stillsHandlers.add_still_result(
      prod([planned()]),
      {
        op: "add_still_result",
        shotId: "p1",
        result: {
          url: "https://r2.example/p1.png",
          provider: "gpt-image-2",
          prompt: "@Natalie sprints down a narrow Roman alley",
        },
      },
      ctx,
    )
    const shot = production.shots[0]!
    expect(shot.still?.url).toBe("https://r2.example/p1.png")
    // Import/export spec §5: the plan is the AUTHORED intent, and a render is a
    // separate record. The composer already ranks the result above the plan, so
    // nothing needs the plan deleted — and deleting it would lose the levers no
    // result stores (a clip's cameraMotionId) plus every unrendered stage.
    expect(shot.plan).toEqual(planned().plan)
  })

  it("keeps the plan when a clip lands on a scene that never framed", () => {
    const { production } = clipsHandlers.add_clip_result(
      prod([planned()]),
      {
        op: "add_clip_result",
        shotId: "p1",
        result: {
          url: "https://r2.example/p1.mp4",
          provider: "seedance-2",
          duration: 10,
        },
      },
      ctx,
    )
    const shot = production.shots[0]!
    expect(shot.clip?.url).toBe("https://r2.example/p1.mp4")
    expect(shot.plan).toEqual(planned().plan)
  })
})

describe("recipe consumption — the CLIP half (import.test.ts L102)", () => {
  const recipeShot = (): Shot => ({
    id: "r1",
    recipe: {
      framing: { prompt: "a dune at dawn", provider: "nano-banana" },
      directing: { prompt: "wind ripples the sand", duration: 5 },
      voice: { text: "Dawn broke." },
    },
  })

  it("a landing clip consumes directing", () => {
    const { production } = clipsHandlers.add_clip_result(
      prod([recipeShot()]),
      {
        op: "add_clip_result",
        shotId: "r1",
        result: {
          url: "https://r2.example/dune.mp4",
          provider: "grok-i2v",
          prompt: "wind ripples the sand",
          duration: 5,
        },
      },
      ctx,
    )
    expect(production.shots[0]!.recipe?.directing).toBeUndefined()
    expect(production.shots[0]!.recipe?.framing?.prompt).toBe("a dune at dawn")
    expect(production.shots[0]!.recipe?.voice?.text).toBe("Dawn broke.")
  })
})

describe("trash — a direction-bearing shot survives delete → reload → restore (direction.test.ts L277)", () => {
  const LOOK = { "lighting-time-of-day": "golden-hour" } as const
  const CLIP_LOOK = { ...LOOK, "camera-motion": "dolly-in" } as const

  /** Serialize a production, parse it back — the studio helper's own reload. */
  const reload = (production: Production): Production =>
    parseProduction({
      id: "wf-1",
      name: "wf-1",
      ...serializeProduction(
        production.shots,
        production.selectedShotId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        production.trash,
      ),
    })

  it("rebuilds the still WITH its direction after the LAST result was deleted", () => {
    const shot: Shot = { id: "s1" }
    const added = stillsHandlers.add_still_result(
      prod([shot]),
      {
        op: "add_still_result",
        shotId: "s1",
        result: {
          url: "https://r2.example/1.png",
          provider: "nano-banana",
          prompt: "a rooftop at dusk",
          promptFormat: 2,
          look: LOOK,
        },
      },
      ctx,
    ).production
    const wire = added.shots[0]!.still!.direction
    const emptied = stillsHandlers.remove_still_result(
      added,
      { op: "remove_still_result", shotId: "s1", result: "https://r2.example/1.png" },
      ctx,
    ).production
    expect(emptied.shots[0]!.still).toBeUndefined()

    const reloaded = reload(emptied)
    const restored = trashHandlers.restore_trashed(
      reloaded,
      { op: "restore_trashed", trashId: reloaded.trash![0]!.id },
      ctx,
    ).production
    expect(restored.shots[0]!.still!.direction).toEqual(wire)
  })

  it("rebuilds the clip WITH its direction after the LAST result was deleted", () => {
    const shot: Shot = { id: "s1" }
    const added = clipsHandlers.add_clip_result(
      prod([shot]),
      {
        op: "add_clip_result",
        shotId: "s1",
        result: {
          url: "https://r2.example/1.mp4",
          prompt: "a slow dolly in",
          promptFormat: 2,
          look: CLIP_LOOK,
        },
      },
      ctx,
    ).production
    const wire = added.shots[0]!.clip!.direction
    const emptied = clipsHandlers.remove_clip_result(
      added,
      { op: "remove_clip_result", shotId: "s1", result: "https://r2.example/1.mp4" },
      ctx,
    ).production
    expect(emptied.shots[0]!.clip).toBeUndefined()

    const reloaded = reload(emptied)
    const restored = trashHandlers.restore_trashed(
      reloaded,
      { op: "restore_trashed", trashId: reloaded.trash![0]!.id },
      ctx,
    ).production
    expect(restored.shots[0]!.clip!.direction).toEqual(wire)
  })
})

