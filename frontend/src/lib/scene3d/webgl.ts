/**
 * WebGL capability probe for the 3D preview.
 *
 * A canvas without WebGL (locked-down browser, blocklisted GPU, headless test
 * environment) must NOT take the panel down with it: the spec requires an
 * actionable fallback that KEEPS the scene data, so the user can still edit
 * numerically, restore revisions and render the MP4 server-side.
 *
 * The probe creates a throwaway context and releases it immediately —
 * browsers cap the number of live WebGL contexts per page, and the editor can
 * have several scene nodes open over a session.
 */
let cached: boolean | undefined

export function hasWebGL(): boolean {
  if (cached !== undefined) return cached
  if (typeof document === "undefined") {
    cached = false
    return cached
  }
  try {
    const canvas = document.createElement("canvas")
    const gl =
      (canvas.getContext("webgl2") as WebGLRenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null)
    if (!gl) {
      cached = false
      return cached
    }
    const lose = gl.getExtension("WEBGL_lose_context")
    lose?.loseContext()
    cached = true
    return cached
  } catch {
    cached = false
    return cached
  }
}

/** Test seam — forget the probe result. */
export function resetWebGLProbe(): void {
  cached = undefined
}
