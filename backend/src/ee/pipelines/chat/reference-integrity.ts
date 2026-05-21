import type { ShowrunnerPlan } from "@nodaro/shared"

export type ReferenceIntegrityResult =
  | { ok: true }
  | {
      ok: false
      error: "manifest_key_still_referenced"
      removed_key: string
      manifest: "cast" | "locations" | "objects"
      remaining_refs: Record<number, string[]>
      hint: string
    }

/**
 * Validate a proposed ShowrunnerPlan edit (`after`) against the current
 * plan (`before`) — when an entry is removed from cast/locations/objects,
 * confirm no `scenes[*]` still references its key.
 *
 * Returns ok=true if no removed entry has residual references. Otherwise
 * returns the FIRST conflict (in cast → locations → objects order; within
 * a manifest, in `before.<manifest>` order) with a structured hint the
 * chat-refine-showrunner can read on its next turn.
 */
export function checkReferenceIntegrity(
  before: ShowrunnerPlan,
  after: ShowrunnerPlan,
): ReferenceIntegrityResult {
  // 1. Cast removals
  const afterCastKeys = new Set(after.cast.map((c) => c.key))
  for (const c of before.cast) {
    if (afterCastKeys.has(c.key)) continue
    const refs = scanCastRefs(c.key, after)
    if (Object.keys(refs).length > 0) {
      return {
        ok: false,
        error: "manifest_key_still_referenced",
        removed_key: c.key,
        manifest: "cast",
        remaining_refs: refs,
        hint: buildHint("cast", c.key, refs),
      }
    }
  }
  // 2. Location removals
  const afterLocationKeys = new Set(after.locations.map((l) => l.key))
  for (const l of before.locations) {
    if (afterLocationKeys.has(l.key)) continue
    const refs = scanLocationRefs(l.key, after)
    if (Object.keys(refs).length > 0) {
      return {
        ok: false,
        error: "manifest_key_still_referenced",
        removed_key: l.key,
        manifest: "locations",
        remaining_refs: refs,
        hint: buildHint("locations", l.key, refs),
      }
    }
  }
  // 3. Object removals
  const afterObjectKeys = new Set(after.objects.map((o) => o.key))
  for (const o of before.objects) {
    if (afterObjectKeys.has(o.key)) continue
    const refs = scanObjectRefs(o.key, after)
    if (Object.keys(refs).length > 0) {
      return {
        ok: false,
        error: "manifest_key_still_referenced",
        removed_key: o.key,
        manifest: "objects",
        remaining_refs: refs,
        hint: buildHint("objects", o.key, refs),
      }
    }
  }
  return { ok: true }
}

function scanCastRefs(key: string, plan: ShowrunnerPlan): Record<number, string[]> {
  const out: Record<number, string[]> = {}
  for (const scene of plan.scenes) {
    const hits: string[] = []
    scene.cast_keys.forEach((k, i) => {
      if (k === key) hits.push(`cast_keys[${i}]`)
    })
    scene.dialogue.forEach((d, i) => {
      if (d.cast_key === key) hits.push(`dialogue[${i}].cast_key`)
    })
    if (hits.length > 0) out[scene.scene_index] = hits
  }
  return out
}

function scanLocationRefs(key: string, plan: ShowrunnerPlan): Record<number, string[]> {
  const out: Record<number, string[]> = {}
  for (const scene of plan.scenes) {
    if (scene.location_key === key) out[scene.scene_index] = ["location_key"]
  }
  return out
}

function scanObjectRefs(key: string, plan: ShowrunnerPlan): Record<number, string[]> {
  const out: Record<number, string[]> = {}
  for (const scene of plan.scenes) {
    const hits: string[] = []
    scene.object_keys.forEach((k, i) => {
      if (k === key) hits.push(`object_keys[${i}]`)
    })
    if (hits.length > 0) out[scene.scene_index] = hits
  }
  return out
}

function buildHint(
  manifest: "cast" | "locations" | "objects",
  removedKey: string,
  refs: Record<number, string[]>,
): string {
  const noun =
    manifest === "cast"
      ? "cast member"
      : manifest === "locations"
        ? "location"
        : "object"
  const sceneList = Object.entries(refs)
    .map(([sceneIdx, fields]) => `scene ${sceneIdx} (${fields.join(", ")})`)
    .join(" and ")
  return `Cannot remove ${noun} '${removedKey}': still referenced by ${sceneList}. Remove or replace those references first.`
}
