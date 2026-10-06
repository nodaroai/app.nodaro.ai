import { isRenderNodeType } from "@nodaro/shared"

/**
 * A PREVIEW render: a render job (or node — any of `RENDER_NODE_TYPES`) at
 * `quality: "proxy"` — the 720p cut a person reviews before Render final. A preview is private on every
 * lane (F1): the route and the workflow run insert its job `force_private`, and
 * both media workers decide its visibility with `previewRender` set, so it never
 * reaches the public gallery whatever the owner's public-outputs preference.
 *
 * Keyed on the job name, which for a render is also its node type
 * (the job is never renamed by quality — only its credit id is).
 */
export function isPreviewRender(jobOrNodeType: string | null | undefined, quality: unknown): boolean {
  return isRenderNodeType(jobOrNodeType) && quality === "proxy"
}
