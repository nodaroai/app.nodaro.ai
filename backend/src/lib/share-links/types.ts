/**
 * Share links (migration 680): the wire shapes of `/v1/shares` and
 * `/v1/public/shares/:token`. The SDK declares the same shapes itself
 * (`packages/client/src/resources/shares.ts`), so it stays dependency-free.
 */

export const SHARE_KINDS = ["job", "session", "project"] as const
export type ShareKind = (typeof SHARE_KINDS)[number]

/** A `share_links` row as the service role reads it. */
export interface ShareLinkRow {
  readonly id: string
  readonly token: string
  readonly owner_id: string
  readonly kind: ShareKind
  readonly target_id: string
  readonly allow_copy: boolean
  readonly created_at: string
  readonly updated_at: string
  readonly revoked_at: string | null
}

/** The owner's view of one item's link. */
export interface Share {
  readonly token: string
  readonly kind: ShareKind
  readonly targetId: string
  /** False once turned off: the link answers 404 until it is turned on again, with the same token. */
  readonly shared: boolean
  /** The viewer is also given the reference files the result was made from. */
  readonly allowCopy: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

export type SharedMediaKind = "image" | "video" | "audio"

/** A setting value as a link shows it: no addresses, no ids. */
export type SharedSettingValue =
  | string
  | number
  | boolean
  | readonly SharedSettingValue[]
  | { readonly [key: string]: SharedSettingValue }

/** One result as a link shows it. Never its owner, its charge, its error or the route that ran it. */
export interface SharedJob {
  readonly id: string
  /** `input_data.type`, e.g. `"generate-image"`. */
  readonly type: string
  readonly mediaKind: SharedMediaKind
  readonly outputUrl: string
  /** Every file of that kind, when the job made several. */
  readonly outputUrls?: readonly string[]
  readonly width?: number
  readonly height?: number
  readonly durationSec?: number
  /** The owner's name for the result, or null. */
  readonly title: string | null
  readonly createdAt: string
  /** The prompt as the person wrote it; null for a trend run. */
  readonly prompt: string | null
  readonly negativePrompt?: string | null
  /** The public model id and its display name; null when the model is not in the public catalog. */
  readonly model: { readonly id: string; readonly name: string } | null
  readonly settings: { readonly [key: string]: SharedSettingValue }
  /** Only on a link that allows copying. */
  readonly references?: readonly SharedReference[]
  /** A trend run: its trend, and no prompt or settings (the recipe is the platform's). */
  readonly trend?: { readonly slug: string; readonly name: string }
}

export interface SharedReference {
  readonly url: string
  readonly kind: SharedMediaKind
}

export interface SharedSession {
  readonly title: string | null
  readonly tool: string | null
  readonly createdAt: string
  /** The results the link shows (`GET /v1/public/shares/:token/items`). */
  readonly itemCount: number
}

export interface SharedProjectSession {
  readonly id: string
  readonly title: string | null
  readonly tool: string | null
  readonly itemCount: number
  readonly coverUrl: string | null
}

export interface SharedProject {
  readonly name: string
  readonly sessions: readonly SharedProjectSession[]
}

export interface PublicShare {
  readonly kind: ShareKind
  readonly allowCopy: boolean
  readonly job?: SharedJob
  readonly session?: SharedSession
  readonly project?: SharedProject
}

/**
 * Why an item cannot be shared (`422 share_not_allowed`, `reason`):
 *  - `not_completed`: the job has not finished (or failed, or was cancelled);
 *  - `no_media`: it made no image, video or sound a link can show;
 *  - `private_output`: it is kept private — made from private inputs, a preview
 *    render, or work done in a workspace (`jobs.force_private`);
 *  - `content_filtered`: its prompt or name trips the content filter that keeps
 *    such work out of the public gallery;
 *  - `restricted`: an administrator restricted it (a content restriction, which
 *    also places it under legal hold);
 *  - `workspace`: a session or project of a workspace (its work is never public);
 *  - `sharing_disabled`: this deployment does not allow public work.
 */
export type ShareRefusal =
  | "not_completed"
  | "no_media"
  | "private_output"
  | "content_filtered"
  | "restricted"
  | "workspace"
  | "sharing_disabled"
