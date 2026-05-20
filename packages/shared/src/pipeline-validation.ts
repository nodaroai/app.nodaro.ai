import type { ShowrunnerPlan } from "./pipeline-types"

export interface ObjectsValidationIssue {
  severity: "blocking" | "warning"
  type:
    | "duplicate_key"
    | "empty_significance"
    | "orphan_object"
    | "unresolved_scene_object_ref"
  object_key?: string
  scene_index?: number
  message: string
}

export interface ObjectsValidationResult {
  ok: boolean
  verdict: "pass" | "fail"
  issues: ObjectsValidationIssue[]
}

export function validateObjects(
  objects: ShowrunnerPlan["objects"],
  plan: ShowrunnerPlan,
): ObjectsValidationResult {
  const issues: ObjectsValidationIssue[] = []

  // 1. Duplicate keys
  const seenKeys = new Map<string, number>()
  for (const obj of objects) {
    seenKeys.set(obj.key, (seenKeys.get(obj.key) ?? 0) + 1)
  }
  for (const [key, count] of seenKeys) {
    if (count > 1) {
      issues.push({
        severity: "blocking",
        type: "duplicate_key",
        object_key: key,
        message: `Object key "${key}" appears ${count} times — keys must be unique`,
      })
    }
  }

  // 2. Empty narrative_significance
  for (const obj of objects) {
    if (!obj.narrative_significance || obj.narrative_significance.trim() === "") {
      issues.push({
        severity: "blocking",
        type: "empty_significance",
        object_key: obj.key,
        message: `Object "${obj.key}" has empty narrative_significance`,
      })
    }
  }

  // 3. Unresolved scene → object refs
  const objectKeySet = new Set(objects.map((o) => o.key))
  const referencedKeys = new Set<string>()
  for (const sc of plan.scenes) {
    for (const k of sc.object_keys) {
      referencedKeys.add(k)
      if (!objectKeySet.has(k)) {
        issues.push({
          severity: "blocking",
          type: "unresolved_scene_object_ref",
          object_key: k,
          scene_index: sc.scene_index,
          message: `Scene ${sc.scene_index} references unknown object_key "${k}"`,
        })
      }
    }
  }

  // 4. Orphan objects (listed but never referenced) — warning only
  for (const obj of objects) {
    if (!referencedKeys.has(obj.key)) {
      issues.push({
        severity: "warning",
        type: "orphan_object",
        object_key: obj.key,
        message: `Object "${obj.key}" listed but no scene references it`,
      })
    }
  }

  const ok = !issues.some((i) => i.severity === "blocking")
  return { ok, verdict: ok ? "pass" : "fail", issues }
}
