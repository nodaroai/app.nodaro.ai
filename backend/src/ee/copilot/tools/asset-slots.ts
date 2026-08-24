/**
 * Which nodes can be handed a file, and what happens when one is.
 *
 * The model never writes an address. It writes `data.assetId` — the field the
 * upload nodes already have — and the server fills in everything that follows
 * from it. So the model's natural action is the correct one: before this, an
 * `assetId` written by an agent was persisted, read by nobody, and the node
 * stayed empty. Silence again.
 *
 * The counterpart matters as much: any OTHER way of pointing at a file has to
 * fail loudly and name this one. A raw URL is already refused by the egress
 * lock; an object in `data.url` (the shape a model reaches for when it invents
 * its own sentinel) is refused here.
 */
import type { AssetKind, ResolvedAsset } from "./asset-refs.js"

/** Node type → the kind of file it takes. The whole allowlist, in one place. */
export const ASSET_SLOT_KIND: Record<string, AssetKind> = {
  "upload-image": "image",
  "upload-video": "video",
  "upload-audio": "audio",
}

/** The node type a file of each kind belongs on, for the error message. */
const NODE_FOR_KIND: Record<AssetKind, string> = {
  image: "upload-image",
  video: "upload-video",
  audio: "upload-audio",
}

/**
 * Everything a resolved file writes onto the node.
 *
 * The WHOLE copy, every time — not just the url. A node keeps the filename,
 * size and type of whatever it points at, so stamping a new file's url over an
 * old file's filename produces a node that says one thing and does another. The
 * copy is derived, so it is replaced as a unit or not at all.
 */
export function assetStamp(asset: ResolvedAsset): Record<string, unknown> {
  return {
    assetId: asset.id,
    url: asset.url,
    r2Url: asset.url,
    // A file the user picked is theirs; an external address is a different
    // provenance and must not survive being pointed somewhere else.
    externalUrl: "",
    thumbnailUrl: asset.thumbnailUrl,
    filename: asset.filename,
    fileSize: asset.fileSize,
    mimeType: asset.mimeType,
    isUploading: false,
    uploadError: "",
  }
}

/** True when this node type takes a file at all. */
export function isAssetSlot(nodeType: string | undefined): boolean {
  return typeof nodeType === "string" && nodeType in ASSET_SLOT_KIND
}

/**
 * The `assetId` this write would put on the node, when it is a CHANGE.
 *
 * Only a change resolves. An upsert that echoes a whole node back re-sends the
 * id it already had, and re-resolving that would (a) cost a lookup per echo and
 * (b) fail the edit outright once the asset is deleted — punishing the model
 * for faithfully repeating what was already there.
 */
export function changedAssetId(
  stored: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): string | null {
  const id = next.assetId
  if (typeof id !== "string" || id.length === 0) return null
  return id === stored?.assetId ? null : id
}

/** Every field a resolved file owns on the node. */
const STAMP_FIELDS = Object.keys(
  assetStamp({ id: "", kind: "image", url: "", filename: "", mimeType: "", fileSize: 0, thumbnailUrl: "" }),
)

/**
 * Keep the file a node already has, through an edit that was not about it.
 *
 * An upsert replaces the node WHOLE, and the doctrine tells the model to write
 * `assetId` and leave every other field alone — so a model doing exactly what
 * it was told, on a node that already has its file, would send `{assetId}` and
 * erase the very thing it was pointing at. The address it cannot rewrite would
 * be destroyed by the one field it can.
 *
 * The stored copy is already correct for that id, so this costs no lookup. It
 * follows the ID: a node whose file was cleared has no id, and nothing comes
 * back.
 */
export function carryStoredMedia(
  stored: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  // Only ever called where `changedAssetId` returned null, so "the id did not
  // change" is the caller's guarantee, not a condition to re-test here. A
  // node with no id has nothing to follow and no media to carry — its stamp
  // fields are empty by construction, since only a stamp or an upload ever
  // sets them, and both set the id at the same time.
  if (!stored || !stored.assetId) return next

  const carried: Record<string, unknown> = { ...next }
  for (const field of STAMP_FIELDS) {
    if (carried[field] === undefined && stored[field] !== undefined) carried[field] = stored[field]
  }
  return carried
}

/** The message for an id that resolved to the wrong sort of file. */
export function wrongKindMessage(id: string, got: AssetKind, nodeType: string): string {
  return `${id} is a ${got}, so it belongs on a "${NODE_FOR_KIND[got]}" node, not "${nodeType}".`
}

/**
 * The message for an id that did not resolve.
 *
 * ONE wording for every reason — not theirs, does not exist, still generating.
 * Three messages would let a model tell those apart, which turns a tool it is
 * allowed to call into a way to ask whether an id exists.
 */
export function unresolvedMessage(ids: readonly string[]): string {
  return `${ids.join(", ")} is not a file in this user's library. Use an id from the [references] line of their message, or from browse_gallery / browse_uploads — never invent one.`
}

/** The message for a model that invented its own way to point at a file. */
export function wrongSpellingMessage(nodeType: string, path: string): string {
  return `I can't write ${path} on a "${nodeType}" node. To use one of the user's files, set "assetId" to its id and leave the rest to me.`
}
