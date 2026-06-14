import type { ComponentType } from "react"

/** Props every studio page receives. `S` is the entity studio-state type
 *  (e.g. CharacterStudioState). `jobs` is the entity's job-tracking object. */
export interface StudioPageProps<S = unknown, J = unknown> {
  state: S
  jobs: J
}

export interface StudioBadge {
  kind: "count" | "check"
  /** For "count": the number (hidden when 0 unless `showZero`). Ignored for "check". */
  value?: number
  showZero?: boolean
}

/** Count-badge selector for entity studios whose state exposes a nullable
 *  `stagedData` (location/object/creature). `stagedData` is null on cold-load;
 *  the shell only mounts the nav once a body exists, but guard anyway so a badge
 *  selector never throws. Returns the picked array's length, or 0. */
export function stagedLen<S extends { stagedData: unknown }>(
  s: S,
  pick: (d: NonNullable<S["stagedData"]>) => { length: number } | undefined,
): number {
  return s.stagedData ? (pick(s.stagedData as NonNullable<S["stagedData"]>)?.length ?? 0) : 0
}

export interface StudioPageDef<S = unknown, J = unknown> {
  key: string
  label: string
  icon: string
  Component: ComponentType<StudioPageProps<S, J>>
  /** Optional badge derived from current state. */
  badge?: (state: S) => StudioBadge | null
  /** Optional visibility predicate (e.g. LoRA → hasCredits). Defaults to visible. */
  visible?: (ctx: StudioVisibilityCtx) => boolean
}

export interface StudioVisibilityCtx {
  hasCredits: boolean
}

export interface StudioGroupDef<S = unknown, J = unknown> {
  label: string
  pages: StudioPageDef<S, J>[]
}

/** Tailwind classes applied to the ACTIVE sidebar item. Defaults to character-blue
 *  (see {@link DEFAULT_STUDIO_ACCENT_ACTIVE}); object/location/creature studios can
 *  override with their own accent so the shell isn't hardcoded to one entity. */
export const DEFAULT_STUDIO_ACCENT_ACTIVE = "text-[#3b82f6] bg-[#1a2744] border-r-2 border-[#3b82f6]"

export interface StudioNavConfig<S = unknown, J = unknown> {
  groups: StudioGroupDef<S, J>[]
  /** Optional accent classes for the active sidebar item. Falls back to
   *  {@link DEFAULT_STUDIO_ACCENT_ACTIVE} (character-blue) when unset. */
  accentActiveClassName?: string
}
