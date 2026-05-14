export type ReferencePhotoKind =
  | "front"
  | "sideLeft"
  | "sideRight"
  | "threeQuarterLeft"
  | "threeQuarterRight"
  | "fullBody"
  | "other"

export interface ReferencePhoto {
  readonly url: string
  readonly kind: ReferencePhotoKind
}

export type AssetTarget = "portrait" | "expressions" | "poses" | "motions" | "angles" | "lighting"

const ANGLE_KINDS = new Set<ReferencePhotoKind>([
  "front",
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
      const fronts = all.filter((p) => p.kind === "front")
      return fronts.length > 0 ? fronts : [...all]
    }
    case "poses":
    case "motions": {
      const full = all.filter((p) => p.kind === "fullBody")
      return full.length > 0 ? full : [...all]
    }
    case "angles": {
      const angled = all.filter((p) => ANGLE_KINDS.has(p.kind))
      return angled.length > 0 ? angled : [...all]
    }
  }
}
