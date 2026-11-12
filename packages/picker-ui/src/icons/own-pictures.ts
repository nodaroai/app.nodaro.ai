import { useSyncExternalStore } from "react"

/**
 * A deployment's own picker pictures (`catalogs.images: "own"`), as the API
 * serves them: the `imageUrl` and `imageLargeUrl` of each option in the
 * catalog projection (`GET /v1/catalogs`), which the server takes from what
 * the deployment registered at its composition root (backend
 * lib/picker-pictures.ts). The app registers them here at start, and only
 * under "own" (frontend look-previews-bootstrap.ts): the package never names
 * a deployment's picture on its own, and empty, nothing changes.
 *
 * Every helper that pictures an option reads them when the platform's pictures
 * are off (platform-pictures.ts), in the slots where the platform's picture
 * would be: the character photos (character-art.ts, by catalog id) and the
 * look / music / voice pictures (look-previews/registry.ts, so LookArt and the
 * sound tiles, by the key the platform's renders use there). The enlarged
 * picture is used where a picture is drawn at several sizes (LookArt); a
 * single-file slot draws the picture.
 *
 * They arrive after the first render (the server's answer is fetched), so a
 * component reading them subscribes (`useOwnPickerPicturesVersion`).
 */
export interface OwnPickerPicture {
  /** Absolute URL of the picture. */
  readonly url: string
  /** Absolute URL of its enlarged version, when the deployment gave one. */
  readonly largeUrl?: string
}

/** One catalog's pictures, keyed by option id. */
export interface OwnPickerPictureSet {
  readonly catalogId: string
  /**
   * The key LookArt reads this picker's pictures by — the key the platform's
   * renders use for it (a look picker's node type, a music / voice picker's
   * catalog id) — or undefined for a picker the platform pictures no other way
   * than its own helpers (the character photos) or not at all. The app decides
   * it (frontend look-previews-bootstrap.ts).
   */
  readonly lookKey?: string
  readonly pictures: Readonly<Record<string, OwnPickerPicture>>
}

type Pictures = Readonly<Record<string, OwnPickerPicture>>
let byCatalog: ReadonlyMap<string, Pictures> = new Map()
let byLookKey: ReadonlyMap<string, Pictures> = new Map()
let version = 0
const listeners = new Set<() => void>()

function publish(): void {
  version += 1
  for (const listener of listeners) listener()
}

/**
 * Replace the registered pictures with these (the server's whole answer: a
 * later answer replaces an earlier one). Each set is reachable by its catalog
 * id, and by its LookArt key when it has one.
 */
export function registerOwnPickerPictures(sets: readonly OwnPickerPictureSet[]): void {
  const catalogs = new Map<string, Pictures>()
  const lookKeys = new Map<string, Pictures>()
  for (const set of sets) {
    if (Object.keys(set.pictures).length === 0) continue
    const pictures = Object.freeze({ ...set.pictures })
    catalogs.set(set.catalogId, pictures)
    if (set.lookKey !== undefined) lookKeys.set(set.lookKey, pictures)
  }
  byCatalog = catalogs
  byLookKey = lookKeys
  publish()
}

function pictureIn(set: Pictures | undefined, optionId: string): OwnPickerPicture | undefined {
  return set && Object.hasOwn(set, optionId) ? set[optionId] : undefined
}

/** The picture of one option of a catalog (by catalog id); undefined when it has none. */
export function ownPickerPicture(catalogId: string, optionId: string): OwnPickerPicture | undefined {
  return pictureIn(byCatalog.get(catalogId), optionId)
}

/** Whether any option of the catalog has one. */
export function hasOwnPickerPictures(catalogId: string): boolean {
  return byCatalog.has(catalogId)
}

/** The picture LookArt draws for one option, by its LookArt key; undefined when it has none. */
export function ownLookPicture(lookKey: string, optionId: string): OwnPickerPicture | undefined {
  return pictureIn(byLookKey.get(lookKey), optionId)
}

/** Whether any option LookArt draws under this key has one. */
export function hasOwnLookPictures(lookKey: string): boolean {
  return byLookKey.has(lookKey)
}

export function subscribeOwnPickerPictures(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Moves on every registration: a reader's cache key. */
export function ownPickerPicturesVersion(): number {
  return version
}

/** Re-renders the caller when the pictures are registered (they arrive after the first render). */
export function useOwnPickerPicturesVersion(): number {
  return useSyncExternalStore(subscribeOwnPickerPictures, ownPickerPicturesVersion, ownPickerPicturesVersion)
}

/** Test seam: forget every registration. */
export function resetOwnPickerPicturesForTests(): void {
  byCatalog = new Map()
  byLookKey = new Map()
  publish()
}
