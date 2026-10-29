/**
 * `virtual:media-editor` — resolved by `header-module-plugin.ts` with the same
 * decision as `virtual:site-header`: the shared media editor's parts on a
 * cloud build with the shared header, the stub (`media-editor-stub.ts`)
 * everywhere else. Typed by this app's own subset (`media-editor-types.ts`),
 * never by the package, so public CI typechecks without it.
 *
 * Every part is `null` in the stub, so a caller checks `mediaEditorAvailable`
 * AND the part before using it (the trend admin narrows them once:
 * `ee/app/(admin)/admin/trends/components/source-intake/parts.ts`).
 */
declare module "virtual:media-editor" {
  import type { MediaEditorParts } from "@/ee/shell/media-editor-types"

  export type {
    CropPanelProps,
    CropSource,
    MediaEditorParts,
    PlayerAdapter,
    RatioId,
    RatioPickerProps,
    Rect,
    Size,
    TrimPanelProps,
    TrimRange,
  } from "@/ee/shell/media-editor-types"

  /** True only when the build resolved the real editor. */
  export const mediaEditorAvailable: boolean
  export const TrimPanel: MediaEditorParts["TrimPanel"] | null
  export const CropPanel: MediaEditorParts["CropPanel"] | null
  export const RatioPicker: MediaEditorParts["RatioPicker"] | null
  export const htmlMediaAdapter: MediaEditorParts["htmlMediaAdapter"] | null
  export const defaultRange: MediaEditorParts["defaultRange"] | null
  export const clampRange: MediaEditorParts["clampRange"] | null
  export const formatTime: MediaEditorParts["formatTime"] | null
  export const fullRect: MediaEditorParts["fullRect"] | null
  export const isWholeFrame: MediaEditorParts["isWholeFrame"] | null
}
