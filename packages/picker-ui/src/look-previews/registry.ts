import { useSyncExternalStore } from "react"
import { hasOwnLookPictures, ownLookPicture, ownPickerPicturesVersion, subscribeOwnPickerPictures } from "../icons/own-pictures"

/** Catalog option id → rendered preview URL, for one picker. */
export type LookPreviewSet = Readonly<Record<string, string>>

/** Picker (node type; catalog id for the music / voice pickers) → its preview set. */
export type LookPreviewSets = Readonly<Record<string, LookPreviewSet>>

/**
 * Which rendered look previews this deployment shows. Empty by default: the
 * package never reaches a CDN on its own — the app registers the sets it is
 * allowed to show (the Cloud edition registers LOOK_PREVIEW_SETS and the music /
 * voice pickers' SOUND_RENDER_SETS at start).
 * Everything that pictures a look option reads through here, so the picker
 * tile, the canvas node, the app input card and the connected-sources list
 * can never disagree about the picture.
 *
 * A deployment that shows its own pictures (`catalogs.images: "own"`) has no
 * render registered; its own pictures (icons/own-pictures.ts, registered only
 * then) answer here instead, under the key the platform's renders use for
 * that picker — a look picker's node type, a music / voice picker's catalog
 * id; a picker the platform has no render for gets none here — with their enlarged version
 * (`getLookPreviewLargeUrl`) for the large sizes LookArt draws.
 */
let registered: LookPreviewSets = {}
let version = 0
const listeners = new Set<() => void>()

export function registerLookPreviews(sets: LookPreviewSets): void {
  registered = { ...registered, ...sets }
  version += 1
  for (const listener of listeners) listener()
}

/** The registered preview URL for one option (a render, or the deployment's own picture), or undefined. */
export function getLookPreviewUrl(pickerKey: string, id: string): string | undefined {
  return registered[pickerKey]?.[id] ?? ownLookPicture(pickerKey, id)?.url
}

/**
 * The enlarged version of the option's picture, for the large sizes: only a
 * deployment's own picture has one (a render is resized by the CDN instead).
 * Read it beside `useLookPreviewUrl`, which re-renders when it arrives.
 */
export function getLookPreviewLargeUrl(pickerKey: string, id: string): string | undefined {
  return registered[pickerKey]?.[id] === undefined ? ownLookPicture(pickerKey, id)?.largeUrl : undefined
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const unsubscribeOwn = subscribeOwnPickerPictures(listener)
  return () => {
    listeners.delete(listener)
    unsubscribeOwn()
  }
}

// Both counters only grow, so their sum moves whenever either does.
const getVersion = (): number => version + ownPickerPicturesVersion()

/** Same as getLookPreviewUrl, re-rendering when a set is registered later. */
export function useLookPreviewUrl(pickerKey: string, id: string): string | undefined {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  return getLookPreviewUrl(pickerKey, id)
}

/** Whether this deployment registered any render for the picker, or shows any picture of its own there. */
export function hasLookPreviews(pickerKey: string): boolean {
  const set = registered[pickerKey]
  return (set !== undefined && Object.keys(set).length > 0) || hasOwnLookPictures(pickerKey)
}

/** Same as hasLookPreviews, re-rendering when a set is registered later. */
export function useHasLookPreviews(pickerKey: string): boolean {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  return hasLookPreviews(pickerKey)
}

/** Test seam: forget every registration. */
export function resetLookPreviewsForTests(): void {
  registered = {}
  version += 1
  for (const listener of listeners) listener()
}
