import type { UsageMode } from "@nodaro/shared"

/** Structural types shared with the app's tag-textarea fallback editor.
 *  Duplicated by design: the community fallback must not depend on this
 *  private package. Structural typing keeps both sides compatible; drift
 *  surfaces as a tsc error at the app boundary. */
export interface NodeRefItem {
  id: string
  label: string
  type: string
}

export interface PromptSnippet {
  id: string
  name: string
  description?: string
  text: string
  target: "prompt" | "negative"
  media: string[]
  category?: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface RefImageItem {
  readonly url: string
  readonly label: string
  /**
   * Discriminator for how the autocomplete renders this row and what kind of
   * pill `selectSuggestion` inserts:
   *   - "uploaded" / "wired": legacy `{image:N:label}` ref (TipTap `imageRef` node)
   *   - "character": violet `@<charSlug>:N(:variant)(:mode)` pill (TipTap `characterRef` node)
   *   - "location":  cyan   `@<locSlug>:N(:bucket/variant)(:mode)`  pill (TipTap `locationRef` node)
   *   - "video" / "audio": `{video:N:label}` / `{audio:N:label}` ref (TipTap
   *     `videoRef` / `audioRef` atomic node) — the reference-video / reference-audio
   *     siblings of the image ref, numbered independently per modality.
   */
  readonly source: "uploaded" | "wired" | "character" | "location" | "video" | "audio"
  /** 1-based position matching {image:N} in the prompt. */
  readonly index: number
  /** Default role label inserted by the "@" trigger (e.g. "object", "person"). */
  readonly defaultLabel: string
  /** When source === "character", the slug for the character (e.g. "kira"). */
  readonly characterSlug?: string
  /** When source === "character", the slug for the variant (e.g. "smile"). undefined = canonical. */
  readonly variantSlug?: string
  /** Variant display name for the autocomplete (e.g. "smile", "canonical"). */
  readonly variantDisplayName?: string
  /** Character asset bucket this entry came from ("boards", "expressions", …);
   *  undefined = canonical. Display-only (menu ordering + Board badge). */
  readonly bucket?: string
  /**
   * When `source === "location"`, the slug for the location (e.g. "old-library").
   * Mirrors `characterSlug` — used by the location-aware autocomplete to group
   * entries by location and by `LocationRefView` to resolve thumbnails.
   */
  readonly locationSlug?: string
  /**
   * When `source === "location"` and this entry represents a per-variant asset,
   * the bucket the variant came from — one of "timeOfDay" / "weather" /
   * "seasons" / "angles" / "lighting" / "atmosphereMotions". `undefined` for
   * the canonical main-image entry of a location.
   *
   * The bucket is the disambiguator between the two location slug forms:
   *   - canonical:  `@oldlibrary:1`
   *   - per-variant: `@oldlibrary:1:weather/rain`
   * Two variants from different buckets may share a name (`weather/sunset`
   * vs `lighting/sunset`); the bucket prefix forces the resolver to pull
   * from the right array.
   */
  readonly locationVariantBucket?: string
  /**
   * When `source === "location"` and this entry represents a per-variant asset,
   * the variant slug (e.g. "rain", "neon"). Mirrors `variantSlug` on the
   * character side. Combined with `locationVariantBucket` to form the
   * `:bucket/variant` slug segment.
   */
  readonly locationVariantSlug?: string
  /**
   * When `source === "location"`, display name for the variant in the
   * autocomplete UI (e.g. "rain", "canonical"). Mirrors `variantDisplayName`
   * on the character side.
   */
  readonly locationVariantDisplayName?: string
  /**
   * Character node's `defaultUsageMode`. Mirrors the field on the underlying
   * `ConnectedReference` (see `packages/shared/src/types.ts`) so the
   * autocomplete can decide whether the inserted slug needs a trailing
   * `:mode` segment — only added when the mode is non-default so casual users
   * never see the 4-part form they don't need. The prompt-builder still falls
   * back to this same value at execution time when the slug omits the mode,
   * so insertion is purely a UX/display concern.
   */
  readonly defaultUsageMode?: UsageMode
  /**
   * Character LoRA training status, propagated from the upstream character
   * node's `loraTrainingStatus`. Drives the `<TrainedPill>` next to the
   * character name in the autocomplete root view — display-only, mirrors the
   * canvas card badge. When `"succeeded"`, generations using this character
   * route through the trained LoRA (see `selectLoraRoutingForMentions`).
   */
  readonly loraTrainingStatus?: string | null
}
