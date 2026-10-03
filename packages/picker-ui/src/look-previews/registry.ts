import { useSyncExternalStore } from "react"

/** Catalog option id → rendered preview URL, for one picker. */
export type LookPreviewSet = Readonly<Record<string, string>>

/** Picker (node type) → its preview set. */
export type LookPreviewSets = Readonly<Record<string, LookPreviewSet>>

/**
 * Which rendered look previews this deployment shows. Empty by default: the
 * package never reaches a CDN on its own — the app registers the sets it is
 * allowed to show (the Cloud edition registers LOOK_PREVIEW_SETS at start).
 * Everything that pictures a look option reads through here, so the picker
 * tile, the canvas node, the app input card and the connected-sources list
 * can never disagree about the picture.
 */
let registered: LookPreviewSets = {}
let version = 0
const listeners = new Set<() => void>()

export function registerLookPreviews(sets: LookPreviewSets): void {
  registered = { ...registered, ...sets }
  version += 1
  for (const listener of listeners) listener()
}

/** The registered preview URL for one option, or undefined. */
export function getLookPreviewUrl(pickerKey: string, id: string): string | undefined {
  return registered[pickerKey]?.[id]
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getVersion = (): number => version

/** Same as getLookPreviewUrl, re-rendering when a set is registered later. */
export function useLookPreviewUrl(pickerKey: string, id: string): string | undefined {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  return getLookPreviewUrl(pickerKey, id)
}

/** Whether this deployment registered any render for the picker. */
export function hasLookPreviews(pickerKey: string): boolean {
  const set = registered[pickerKey]
  return set !== undefined && Object.keys(set).length > 0
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
