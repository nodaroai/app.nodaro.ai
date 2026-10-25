/**
 * The trend catalog's model.
 *
 * A trend is a ready-made Cast Swap recipe: a source clip, its slots (the
 * people, pets, products and place a user replaces) and its prompt parts. A
 * trend row (`trends`) carries the catalog fields; each version
 * (`trend_versions`) is a full `TrendVersionData` snapshot. Users only ever
 * see a trend's published version.
 *
 * HIDDEN: the uploaded `source` clip (its `videoUrl`, length and size),
 * `TrendSlot.roleName`, `references`, `trendPrompt`, `prePrompt`,
 * `faceMasking`, `faceMask`, `faceMaskJob` and `klingLength` never leave the server — public responses
 * are built from the other fields. The source's display copy
 * (`source.display`, a browser-safe re-encode in its own file) is public: the
 * trend's page shows it as the original. `engine` is public: the trend's page
 * names it and offers its resolutions.
 */
import type { LocaleId } from "@nodaro/shared/i18n"
import type { CastSwapEngine, CastSwapKlingLength } from "@nodaro/shared/models"
import type { FaceMasking } from "../../../lib/cast-swap-face-masking.js"

export type { CastSwapEngine, CastSwapKlingLength, FaceMasking }

/** The platform's interface languages (the same set `/v1/user/settings` accepts). */
export type Locale = LocaleId

/** Text shown to users: English always, any other platform language optionally. */
export type LocalizedText = { en: string } & Partial<Record<Locale, string>>

export type TrendSlotKind = "person" | "location" | "product" | "pet"

/** A chip: make this trait anew, or keep the one in the user's picture. */
export type Choice = "new" | "original"

/** The chips each kind carries (Cast Swap's per-role traits). A location has none. */
export interface PersonChips { body?: Choice; outfit?: Choice; hair?: Choice }
export interface PetChips { body?: Choice; coat?: Choice }
export interface ProductChips { shape?: Choice; finish?: Choice }

interface TrendSlotBase {
  /** `^[a-z0-9_]{1,32}$`, unique within a version. */
  key: string
  label: LocalizedText
  required: boolean
  hint?: LocalizedText
  /**
   * A picture of who (or what) this slot replaces, e.g. a frame of that actor
   * from the original; in trend storage. Optional; shown with the slot, never
   * sent with a run.
   */
  hintImageUrl?: string
  /** HIDDEN. Who this is in the source clip, e.g. "the woman on the left" (1–200). */
  roleName: string
}

/**
 * A slot's `defaults` are the chips of its own kind. Its `chips` are the ones
 * shown to the person (absent = all of the kind's; `[]` = none). A chip not
 * shown is fixed at its default (else "new"): a run cannot change it.
 */
export type TrendSlot =
  | (TrendSlotBase & { kind: "person"; defaults?: PersonChips; chips?: Array<keyof PersonChips> })
  | (TrendSlotBase & { kind: "pet"; defaults?: PetChips; chips?: Array<keyof PetChips> })
  | (TrendSlotBase & { kind: "product"; defaults?: ProductChips; chips?: Array<keyof ProductChips> })
  | (TrendSlotBase & { kind: "location"; defaults?: never; chips?: never })

/** HIDDEN. A fixed reference sent with every run: 1–3 images and its prompt line (1–500). */
export interface TrendReference { images: string[]; line: string }

/**
 * HIDDEN. A trend's approved face mask: its WHOLE source clip with the faces
 * covered, made once ahead of time (a `cast-swap-face-mask` job of the admin
 * who made it) and copied into the trend's own storage. A run of the trend
 * sends it in place of masking per run (`storedFaceMask`), while it still
 * matches what it was made from: `settingsKey` (`faceMaskSettingsKey`: the
 * source clip and the resolved masking settings) and `recipe` (core's
 * `VIDEO_MASK_RECIPE` and the engine's `faceMaskRecipe`). Written only by the
 * face mask routes; a draft save keeps the stored one.
 */
export interface TrendFaceMask {
  /** The masked clip, in the trend's storage (`trends/<id>/…`). */
  url: string
  /** Its frame count (the source clip's). */
  frames: number
  recipe: { core: string | null; plugin: string }
  settingsKey: string
  /** The job that made it. */
  jobId: string
  stats: { shots: number; heldFrames: number; coverage: number; droppedRegions: number }
  approvedAt: string
  /** The admin who approved it. */
  approvedBy: string
}

/**
 * HIDDEN. The face mask being made: the job "Make face mask" started and the
 * settings key it was made from. Approving requires this job, made from the
 * draft's current settings; approving clears it. Written only by the face
 * mask routes; a draft save keeps the stored one.
 */
export interface TrendFaceMaskJob {
  jobId: string
  settingsKey: string
  startedAt: string
}

/** A promoted example run: its result video and the pictures used per slot. */
export interface TrendExample {
  videoUrl: string
  posterUrl?: string
  width: number
  height: number
  durationSec: number
  /** Slot key → the images that example used for it. */
  slots: Record<string, string[]>
  sourceJobId: string
}

/**
 * The source clip as it is SHOWN: an H.264 / yuv420p / AAC MP4 (faststart)
 * re-encoded from the upload into its OWN file under `trends/<id>/`, even when
 * the upload is already H.264, plus a poster frame. Width, height and length
 * are the copy's (rotation applied, so a portrait phone clip reads portrait).
 * Runs never read it: they edit the uploaded `source.videoUrl`.
 */
export interface TrendSourceDisplay {
  videoUrl: string
  posterUrl: string
  width: number
  height: number
  durationSec: number
}

export interface TrendVersionData {
  name: LocalizedText
  description?: LocalizedText
  /**
   * The clip the trend recasts (4–30 s); null while the draft has none. Its
   * `videoUrl`, length and size are HIDDEN; `display` is its public copy,
   * made when it is uploaded (absent on a version saved before that; such a
   * draft cannot publish: `source_display_missing`).
   */
  source: { videoUrl: string; durationSec: number; width?: number; height?: number; display?: TrendSourceDisplay } | null
  /** Where the 4 s preview starts; null = no preview offered. */
  previewStart: number | null
  slots: TrendSlot[]
  references: TrendReference[]
  /** HIDDEN. Prompt text added to every run (≤ 3000). */
  trendPrompt?: string
  /** HIDDEN. Prompt text placed at the start of every run's prompt (≤ 3000): Cast Swap's `prePrompt`. */
  prePrompt?: string
  /**
   * HIDDEN. Cast Swap's face masking for every run of this trend. Absent or
   * `mode: "off"` = no masking. With `"auto"`, a full run whose preview was
   * masked (`TrendRunRequest.previewJobId`) is sent as `"always"`.
   */
  faceMasking?: FaceMasking
  /** HIDDEN. The approved face mask (see `TrendFaceMask`); absent = none. */
  faceMask?: TrendFaceMask
  /** HIDDEN. The face mask job started last and not approved yet (see `TrendFaceMaskJob`). */
  faceMaskJob?: TrendFaceMaskJob
  /**
   * The video engine every run of this trend uses; the person running it
   * never chooses. Absent = `"seedance-2-5"` (every version saved before the
   * choice): read it with `engineOf`. Kling 4 renders 720p (its default) and
   * 1080p, with no draft.
   */
  engine?: CastSwapEngine
  /**
   * HIDDEN. How a Kling 4 run fits the clip's length (`"cut-end"`, the default
   * when absent, or `"cut-start"`). Read only on a Kling 4 trend.
   */
  klingLength?: CastSwapKlingLength
  examples: TrendExample[]
}

/** `archived`: put away by an admin — off the catalog, kept with its runs (migration 559). */
export type TrendStatus = "draft" | "published" | "unpublished" | "archived"
export type TrendBadge = "trending" | "new"

export interface TrendRow {
  id: string
  slug: string
  status: TrendStatus
  tags: string[]
  badges: TrendBadge[]
  sortOrder: number
  /** The version the admin edits. */
  draftVersion: number
  /** The version users see; null = never published. Kept on unpublish. */
  publishedVersion: number | null
  createdAt: string
  updatedAt: string
}

/** One slot's part of a run request: the user's pictures and chips. */
export interface TrendRunSlot extends PersonChips, PetChips, ProductChips {
  images?: string[]
}

export type TrendResolution = "480p" | "720p" | "1080p"

export interface TrendRunRequest {
  slots: Record<string, TrendRunSlot>
  /** 1-based example whose pictures fill empty optional slots. */
  example?: number
  details?: string
  preview?: boolean
  resolution?: TrendResolution
  draft?: boolean
  sessionId?: string
  projectId?: string
  /**
   * A full run's own preview (a completed preview run of this trend, by the
   * same caller). When the trend's masking is "auto" and that preview ran
   * masked, the full run is masked from the start. Anything else: ignored.
   */
  previewJobId?: string
}
