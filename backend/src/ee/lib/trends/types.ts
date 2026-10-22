/**
 * The trend catalog's model.
 *
 * A trend is a ready-made Cast Swap recipe: a source clip, its slots (the
 * people, pets, products and place a user replaces) and its prompt parts. A
 * trend row (`trends`) carries the catalog fields; each version
 * (`trend_versions`) is a full `TrendVersionData` snapshot. Users only ever
 * see a trend's published version.
 *
 * HIDDEN: `source`, `TrendSlot.roleName`, `references`, `trendPrompt`,
 * `prePrompt` and `faceMasking` never leave the server — public responses are
 * built from the other fields.
 */
import type { LocaleId } from "@nodaro/shared/i18n"
import type { FaceMasking } from "../../../lib/cast-swap-face-masking.js"

export type { FaceMasking }

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
  /** HIDDEN. Who this is in the source clip, e.g. "the woman on the left" (1–200). */
  roleName: string
}

/** A slot's `defaults` are the chips of its own kind. */
export type TrendSlot =
  | (TrendSlotBase & { kind: "person"; defaults?: PersonChips })
  | (TrendSlotBase & { kind: "pet"; defaults?: PetChips })
  | (TrendSlotBase & { kind: "product"; defaults?: ProductChips })
  | (TrendSlotBase & { kind: "location"; defaults?: never })

/** HIDDEN. A fixed reference sent with every run: 1–3 images and its prompt line (1–500). */
export interface TrendReference { images: string[]; line: string }

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

export interface TrendVersionData {
  name: LocalizedText
  description?: LocalizedText
  /** HIDDEN. The clip the trend recasts (4–30 s); null while the draft has none. */
  source: { videoUrl: string; durationSec: number; width?: number; height?: number } | null
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
  examples: TrendExample[]
}

export type TrendStatus = "draft" | "published" | "unpublished"
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
