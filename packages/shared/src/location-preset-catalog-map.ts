/**
 * Adapter from the Location Studio's backend preset strings to canonical
 * picker-catalog entries.
 *
 * The Location Studio's tab presets ship 46 backend-stable variant strings
 * (e.g. "wide", "golden hour", "drone fly-over"). These strings are what the
 * frontend sends to `POST /v1/generate-location-asset` and what backend Zod
 * validates against the `VARIANTS` map in
 * `backend/src/routes/generate-location-asset.ts`. They MUST stay stable.
 *
 * For display, however, we want translated labels that match the rest of
 * the app. Instead of maintaining a parallel `location-variants` i18n
 * catalog (the duplication this file replaces), the Studio looks up each
 * preset against an existing canonical catalog — framing, lighting,
 * atmosphere, camera-motions, seasons — and uses the existing localized
 * label.
 *
 * Adding a new preset to a Location Studio tab: pick the closest entry in
 * the relevant canonical catalog and add a mapping here. If the closest
 * match is wrong, ADD a new entry to the canonical catalog (so the
 * camera-motion picker / framing picker / etc. all benefit), then map.
 */
import type { I18nCatalogId } from "./i18n/types.js"

export interface LocationCatalogRef {
  readonly catalogId: I18nCatalogId
  readonly entryId: string
}

/**
 * Backend variant string → canonical catalog reference.
 *
 * Keys MUST match the strings in `VARIANTS` in
 * `backend/src/routes/generate-location-asset.ts` AND the preset arrays in
 * the Location Studio tab wrappers
 * (`frontend/src/components/editor/location-studio/{time-of-day,weather,seasons,angles,lighting}-tab.tsx`)
 * AND `motion-tab.tsx`'s MOTION_PRESETS.
 */
export const LOCATION_PRESET_TO_CATALOG: Readonly<Record<string, LocationCatalogRef>> = {
  // ── timeOfDay (9) → lighting time-of-day category ────────────────────
  "dawn":         { catalogId: "lighting", entryId: "dawn" },
  "morning":      { catalogId: "lighting", entryId: "morning" },
  "noon":         { catalogId: "lighting", entryId: "noon" },
  "afternoon":    { catalogId: "lighting", entryId: "afternoon" },
  "golden hour":  { catalogId: "lighting", entryId: "golden-hour" },
  "dusk":         { catalogId: "lighting", entryId: "dusk" },
  "blue hour":    { catalogId: "lighting", entryId: "blue-hour" },
  "night":        { catalogId: "lighting", entryId: "night" },
  "midnight":     { catalogId: "lighting", entryId: "midnight" },

  // ── weather (9) → atmosphere ─────────────────────────────────────────
  "clear":        { catalogId: "atmosphere", entryId: "clear" },
  "cloudy":       { catalogId: "atmosphere", entryId: "cloudy" },
  "light rain":   { catalogId: "atmosphere", entryId: "light-rain" },
  "heavy rain":   { catalogId: "atmosphere", entryId: "heavy-rain" },
  "storm":        { catalogId: "atmosphere", entryId: "storm" },
  "snow":         { catalogId: "atmosphere", entryId: "snow" },
  "blizzard":     { catalogId: "atmosphere", entryId: "blizzard" },
  "fog":          { catalogId: "atmosphere", entryId: "fog" },
  "mist":         { catalogId: "atmosphere", entryId: "mist" },

  // ── seasons (4) → seasons (this catalog only exists to serve this tab) ─
  "spring":       { catalogId: "seasons", entryId: "spring" },
  "summer":       { catalogId: "seasons", entryId: "summer" },
  "autumn":       { catalogId: "seasons", entryId: "autumn" },
  "winter":       { catalogId: "seasons", entryId: "winter" },

  // ── angles (8) → framing ────────────────────────────────────────────
  "wide":         { catalogId: "framing", entryId: "wide-shot" },
  "medium":       { catalogId: "framing", entryId: "medium-shot" },
  "closeup":      { catalogId: "framing", entryId: "close-up" },
  // `framing` has `birds-eye` and `overhead` but no plain `aerial`. The
  // semantic intent ("view from above") is `birds-eye`, so we route there.
  "aerial":       { catalogId: "framing", entryId: "birds-eye" },
  "low-angle":    { catalogId: "framing", entryId: "low-angle" },
  "eye-level":    { catalogId: "framing", entryId: "eye-level" },
  "bird's-eye":   { catalogId: "framing", entryId: "birds-eye" },
  "dutch tilt":   { catalogId: "framing", entryId: "dutch-angle" },

  // ── lighting (8) → lighting non-time-of-day categories ───────────────
  // (`"blue hour"` is shared with timeOfDay above — same canonical entry.)
  "soft natural":          { catalogId: "lighting", entryId: "natural" },
  "harsh sunlight":        { catalogId: "lighting", entryId: "harsh-midday" },
  "golden":                { catalogId: "lighting", entryId: "golden-hour" },
  "neon":                  { catalogId: "lighting", entryId: "neon-night" },
  "candlelit":             { catalogId: "lighting", entryId: "candlelight" },
  "cinematic":             { catalogId: "lighting", entryId: "three-point" },
  "dramatic chiaroscuro":  { catalogId: "lighting", entryId: "chiaroscuro" },

  // ── motion (8) → camera-motions ──────────────────────────────────────
  // The "slow" / "gentle" qualifiers are dropped at lookup time — the
  // chip displays the canonical motion name ("Dolly-In", "Pan Left") with
  // the user's locale applied.
  "slow dolly-in":      { catalogId: "camera-motions", entryId: "dolly-in" },
  "slow pan-left":      { catalogId: "camera-motions", entryId: "pan-left" },
  "slow pan-right":     { catalogId: "camera-motions", entryId: "pan-right" },
  "push up":            { catalogId: "camera-motions", entryId: "pedestal-up" },
  "drone fly-over":     { catalogId: "camera-motions", entryId: "fly-over" },
  "gentle drift":       { catalogId: "camera-motions", entryId: "gentle-drift" },
  "parallax":           { catalogId: "camera-motions", entryId: "parallax" },
  "static atmospheric": { catalogId: "camera-motions", entryId: "static" },
}

/**
 * Resolve a backend preset string to its canonical catalog reference, or
 * undefined if the preset is unknown (caller falls back to the raw
 * preset string as the display label).
 */
export function resolveLocationPresetCatalog(preset: string): LocationCatalogRef | undefined {
  return LOCATION_PRESET_TO_CATALOG[preset]
}

/**
 * Each Location Studio tab pulls all its localized labels from a single
 * canonical catalog (the tab's bucket → catalog mapping below). This lets
 * the tab call `useLocalizedCatalog(LOCATION_BUCKET_TO_CATALOG_ID[bucket])`
 * once and resolve every preset chip through the same catalog.
 *
 * Atmosphere motion (motion-tab.tsx) uses `camera-motions` directly — it's
 * a single-bucket tab so the mapping isn't needed there.
 */
export const LOCATION_BUCKET_TO_CATALOG_ID = {
  timeOfDay: "lighting",
  weather:   "atmosphere",
  seasons:   "seasons",
  angles:    "framing",
  lighting:  "lighting",
} as const satisfies Record<string, I18nCatalogId>
