import { describe, expect, it } from "vitest"

import { toConnectedReference } from "@nodaro/shared"
import type {
  MentionCandidate,
  StudioSettingsV3,
  ViewableWorkflow,
} from "@nodaro/studio-production"

import {
  SERIALIZER_OWNED_STUDIO_KEYS,
  landPlan,
  serializeAppend,
  serializeCreate,
  type LandedPlanOk,
} from "../land-plan.js"

/**
 * `land-plan` — a plan landed as a production, and a plan APPENDED to one.
 *
 * The oracle throughout is the studio app's own path: `useLandProduction` for a
 * create, `production-store-shots.ts`'s `pasteShots` for an append. `pasteShots`
 * inserts `mergeCast(...).shots` — the REWRITTEN shots — never the shots it was
 * handed, because a cast collision moves a name and the prose has to move with
 * it (cast spec D6a/D6b: one name is one person, and the words are the only
 * place a text prompt can keep the difference). An append that persisted the
 * pre-merge prose would enroll `Kira 2` and leave every scene still saying
 * `@kira`, pointing the second actor's shots at the first actor's role.
 */

const candidate = (id: string, name: string): MentionCandidate => ({
  id,
  name,
  kind: "character",
  toConnectedReference: () =>
    toConnectedReference({
      id,
      kind: "character",
      name,
      url: `https://r2.example/${id}.png`,
      description: null,
    }),
})

/** The worked example, trimmed to one scene that NAMES its cast member. */
const PLAN = {
  format: "nodaro-studio-production",
  version: 2,
  title: "The Long Walk",
  cast: [{ name: "Kira", kind: "character" }],
  scenes: [
    {
      frame: { prompt: "@Kira on the shoreline at dawn" },
      motion: { prompt: "slow dolly in", seconds: 5 },
    },
  ],
}

function landed(entityId: string): LandedPlanOk {
  const result = landPlan(PLAN, { candidates: [candidate(entityId, "Kira")] })
  if (!result.ok) throw new Error(`the plan did not land: ${result.error}`)
  return result
}

/** A production row as the routes select it, built by the REAL create writer. */
function productionRow(
  studioOverrides: Record<string, unknown> = {},
  from: LandedPlanOk = landed("char-a"),
): ViewableWorkflow {
  const created = serializeCreate(from)
  return {
    id: "00000000-0000-4000-8000-000000000020",
    name: "The Long Walk",
    nodes: created.nodes,
    edges: created.edges,
    settings: { studio: { ...created.settings.studio, ...studioOverrides } },
    version: 3,
    updatedAt: "2026-09-06T10:00:00Z",
  }
}

const studioOf = (settings: { studio: StudioSettingsV3 }) =>
  settings.studio as StudioSettingsV3 & Record<string, unknown>

describe("serializeAppend — a cast collision moves the prose too", () => {
  // A DIFFERENT actor arriving under a name the production already gave to
  // someone else: the merge enrolls it as `kira-2` / "Kira 2".
  const appended = () => serializeAppend(productionRow(), landed("char-b"))

  it("persists the REWRITTEN scene, not the one the import produced", () => {
    const shots = studioOf(appended().settings).shots
    expect(shots).toHaveLength(2)
    const plan = shots[1]!.plan!.frame!
    expect(plan.prompt).toBe("@kira-2 on the shoreline at dawn")
    expect(plan.references![0]).toMatchObject({
      id: "char-b",
      defaultName: "Kira 2",
      characterSlug: "kira-2",
    })
  })

  it("leaves the scenes already here saying what they always said", () => {
    const shots = studioOf(appended().settings).shots
    expect(shots[0]!.plan!.frame!.prompt).toBe("@kira on the shoreline at dawn")
    expect(shots[0]!.plan!.frame!.references![0]).toMatchObject({
      id: "char-a",
      defaultName: "Kira",
    })
  })

  it("enrolls the newcomer beside the keeper", () => {
    const cast = studioOf(appended().settings).cast!
    expect(cast["kira"]).toMatchObject({ assetId: "char-a", displayName: "Kira" })
    expect(cast["kira-2"]).toMatchObject({ assetId: "char-b", displayName: "Kira 2" })
  })

  it("reports the roles it ENROLLED, not the size of the whole cast", () => {
    // The append receipt's `castEnrolled`: appending to a production with a
    // cast of ten adds one role, and "10" would be a lie about what happened.
    expect(appended().enrolled).toEqual([
      { key: "kira-2", displayName: "Kira 2", renamedFrom: "Kira" },
    ])
  })
})

describe("serializeAppend — `settings.studio` the serializer does not own", () => {
  /**
   * Spec §11: "`settings.studio` unknown to the serializer is never erased."
   * The studio app keeps live state beside the index — a composer draft, a
   * soundtrack draft — and the hidden favorites row keeps its whole payload
   * there. An append is a read-modify-write of one row's `settings.studio`; a
   * write that only puts back the keys THIS version of the serializer knows
   * silently destroys everything a newer studio build put there.
   */
  const SIBLINGS = {
    pendingDraft: { shotId: "s1", prompt: "a draft nobody asked us to keep" },
    pendingMusic: { jobId: "job-1" },
    favorites: { character: ["char-a"], location: [] },
    hidden: true,
  }

  it("carries the keys it has never heard of through the write", () => {
    const studio = studioOf(serializeAppend(productionRow(SIBLINGS), landed("char-b")).settings)
    expect(studio.pendingDraft).toEqual(SIBLINGS.pendingDraft)
    expect(studio.pendingMusic).toEqual(SIBLINGS.pendingMusic)
    expect(studio.favorites).toEqual(SIBLINGS.favorites)
    expect(studio.hidden).toBe(true)
  })

  it("still lets the serializer win on every key it DOES own", () => {
    // A stale derived field beside the fresh one: `shotOrder` is DERIVED on
    // every serialize, and a preserved copy of the old array would hand the
    // canvas node ids of a graph that no longer exists.
    const stale = { shotOrder: ["generate-image-stale"] }
    const studio = studioOf(serializeAppend(productionRow(stale), landed("char-b")).settings)
    expect(studio.shots).toHaveLength(2)
    expect(studio.shotOrder).toEqual([])
  })

  it("drops a LEGACY index's own keys instead of carrying them into v3", () => {
    // A v1 row (`shotOrder` + `perShot`) is still a production the append can
    // be pointed at, and `perShot` is a job map for a graph that is about to be
    // rewritten. The app's own v1→v3 read drops it; carrying it through as an
    // "unknown" key would keep a dead job map alive in the v3 blob forever.
    const legacy: ViewableWorkflow = {
      ...productionRow(),
      nodes: [],
      edges: [],
      settings: { studio: { shotOrder: ["generate-image-old"], perShot: { "generate-image-old": { jobId: "job-1" } } } },
    }
    const studio = studioOf(serializeAppend(legacy, landed("char-b")).settings)
    expect(studio).not.toHaveProperty("perShot")
    expect(studio.version).toBe(3)
  })

  it("does not resurrect a key the serializer deliberately PRUNED", () => {
    // A storyboard whose per-shot maps are all orphans prunes to nothing
    // (`storyboardForSave`), so the fresh write omits it — putting the old
    // blob back would undo the prune on every append, forever.
    const orphaned = { storyboard: { scripts: { "shot-that-was-deleted": "gone" } } }
    const studio = studioOf(serializeAppend(productionRow(orphaned), landed("char-b")).settings)
    expect(studio.storyboard).toBeUndefined()
  })
})

describe("SERIALIZER_OWNED_STUDIO_KEYS", () => {
  /**
   * The preserve list is a DENY list over the serializer's own keys, so a key
   * added to `StudioSettingsV3` and left off it would be preserved from the old
   * blob instead of rewritten — a stale value that survives every save. The
   * exhaustiveness is checked by `tsc` (see the type pin in `land-plan.ts`);
   * this is the runtime half, so the file is a test rather than a lint orphan.
   */
  it("names every key the append serializes", () => {
    const written = Object.keys(
      studioOf(serializeAppend(productionRow(), landed("char-b")).settings),
    )
    expect(written.filter((k) => !SERIALIZER_OWNED_STUDIO_KEYS.includes(k as never))).toEqual([])
  })
})
