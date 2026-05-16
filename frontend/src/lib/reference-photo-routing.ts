export type ReferencePhotoKind =
  | "frontFace"          // RENAMED from "front" — explicit face-level shot
  | "sideLeft"
  | "sideRight"
  | "threeQuarterLeft"
  | "threeQuarterRight"
  | "frontBody"          // RENAMED from "fullBody" — explicit full-body natural standing shot
  | "other"

export interface ReferencePhoto {
  readonly url: string
  readonly kind: ReferencePhotoKind
}

/**
 * Asset surfaces a Character Studio generation can target. The split between
 * `headAngles` and `bodyAngles` (migration 118) mirrors the new Reference
 * Photos slot split between `frontFace` and `frontBody`.
 *
 * `angles` is the legacy single-surface target; it is preserved as an alias
 * for `headAngles` so older callers (worker payloads, route tests) keep
 * working without churn.
 */
export type AssetTarget =
  | "portrait"
  | "expressions"
  | "poses"
  | "motions"
  | "angles"        // alias for back-compat — same routing as headAngles
  | "headAngles"
  | "bodyAngles"
  | "lighting"

// Photos that count as a usable "angle" reference for the head-angles flow.
// `frontFace` is included because a face-on shot also provides a head reference.
const HEAD_ANGLE_KINDS = new Set<ReferencePhotoKind>([
  "frontFace",
  "sideLeft",
  "sideRight",
  "threeQuarterLeft",
  "threeQuarterRight",
])

export function routePhotosForAsset(target: AssetTarget, all: readonly ReferencePhoto[]): ReferencePhoto[] {
  if (all.length === 0) return []
  switch (target) {
    case "portrait":
    case "lighting":
      return [...all]
    case "expressions": {
      const fronts = all.filter((p) => p.kind === "frontFace")
      return fronts.length > 0 ? fronts : [...all]
    }
    case "poses":
    case "motions": {
      const full = all.filter((p) => p.kind === "frontBody")
      return full.length > 0 ? full : [...all]
    }
    case "angles":
    case "headAngles": {
      // Prefer face-front + head-rotation refs; fall back to everything.
      const angled = all.filter((p) => HEAD_ANGLE_KINDS.has(p.kind))
      return angled.length > 0 ? angled : [...all]
    }
    case "bodyAngles": {
      // Prefer the explicit body shot; fall back to everything.
      const body = all.filter((p) => p.kind === "frontBody")
      return body.length > 0 ? body : [...all]
    }
  }
}
