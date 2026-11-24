/** A probed clip's DISPLAYED frame: its stored size with the sides swapped for a 90° / 270° rotation tag (a phone clip stored 1920×1080 + rotate 90 is shown 1080×1920). */
export function displayedFrame(probe: { readonly width: number; readonly height: number; readonly rotation?: number }): { width: number; height: number } {
  const turned = probe.rotation === 90 || probe.rotation === 270
  return turned ? { width: probe.height, height: probe.width } : { width: probe.width, height: probe.height }
}
