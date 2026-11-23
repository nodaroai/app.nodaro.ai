/**
 * What a share card's picture shows (pure), and where its rendering lives.
 *
 * Every card has its own 1200 × 630 JPEG on our storage (render.ts), made from
 * what the link shows:
 *   - a picture: the picture itself, whole, over a blurred, darkened fill of itself;
 *   - a video: a frame of it (its poster, else one taken from the video) with a play badge;
 *   - a song or a voice: its art (else the brand's tile) with a play badge and its title;
 *   - a session or a project: a grid of its first results' pictures.
 *
 * The key is derived from the link's token (hashed: the image is public, the
 * token stays the capability) AND from a hash of what the picture shows, so a
 * renamed song or a new cover lands on a new address. The CDN keeps each
 * address for a year (immutable), so an address is written once and never
 * named before it exists.
 */
import { createHash } from "node:crypto"
import type { ShareWorkKind } from "../tool-names.js"

/** Raise to render every card again (a change to how cards are drawn). */
export const CARD_RENDER_VERSION = 1

export const CARD_IMAGE_WIDTH = 1200
export const CARD_IMAGE_HEIGHT = 630
export const CARD_IMAGE_TYPE = "image/jpeg"
/** The most a rendered card may weigh: chats drop a larger preview picture. */
export const CARD_IMAGE_MAX_BYTES = 300 * 1024

/** The folder every rendered card lives under. */
export const SHARE_CARD_PREFIX = "share-cards/"

export type CardPicture =
  /** A picture result: `source` is the picture. */
  | { readonly kind: "picture"; readonly source: string }
  /** A video: its poster when it has one, else `video` (our own copy) to take a frame from. */
  | { readonly kind: "video"; readonly poster: string | null; readonly video: string | null }
  /** A sound: its art, else the brand's tile; its title drawn when the fonts can draw it. */
  | { readonly kind: "sound"; readonly art: string | null; readonly title: string | null; readonly work: ShareWorkKind }
  /** A session or a project: up to four pictures. */
  | { readonly kind: "grid"; readonly sources: readonly string[] }

/** The most pictures a grid shows. */
export const GRID_MAX = 4

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")

/** A stable hash of what the picture shows (and of how cards are drawn). */
export function cardPictureHash(picture: CardPicture): string {
  return sha256(JSON.stringify({ v: CARD_RENDER_VERSION, ...picture })).slice(0, 24)
}

/** Where the card of the link with `token` showing `picture` lives. */
export function cardImageKey(token: string, picture: CardPicture): string {
  return `${SHARE_CARD_PREFIX}${sha256(`share-card:${token}`).slice(0, 32)}/${cardPictureHash(picture)}.jpg`
}
