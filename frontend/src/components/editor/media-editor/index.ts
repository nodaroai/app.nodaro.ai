export { useMediaEditor } from "./use-media-editor"
export { MediaEditorModal } from "./media-editor-modal"
export type { MediaEditorResult } from "./use-media-editor"

/** Resolve the final URL from a media editor result (processed if available, otherwise the raw upload). */
export function resolveMediaEditorUrl(result: import("./use-media-editor").MediaEditorResult): string {
  return result.processedUrl ?? result.uploadResult.url
}
