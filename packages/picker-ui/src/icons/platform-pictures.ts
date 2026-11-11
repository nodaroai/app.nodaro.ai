/**
 * Whether this deployment shows the platform's own picker pictures: the
 * self-hosted photos, emoji and flags under /picker-art/ (the character
 * pickers' photos and topic icons, the music / voice pickers' pictures).
 *
 * On by default, because every edition ships them. The app turns it off at
 * start when the deployment's `catalogs.images` is anything but "default"
 * (frontend look-previews-bootstrap.ts), before the first render, so readers
 * ask it without subscribing. Every helper that names one of those files reads
 * it (character-art.ts, sound-art.ts), so with it off no picker, card or list
 * shows one: each falls back to what it shows for an option that has no
 * picture.
 *
 * The rendered previews on the Nodaro CDN are a separate decision: the app
 * registers them, or not (look-previews/registry.ts).
 */
let shown = true

export function setPlatformPickerPictures(on: boolean): void {
  shown = on
}

export function platformPickerPicturesShown(): boolean {
  return shown
}

/** Test seam: back to the default (shown). */
export function resetPlatformPickerPicturesForTests(): void {
  shown = true
}
