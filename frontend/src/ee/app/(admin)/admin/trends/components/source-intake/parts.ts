// The shared media editor's parts, when this build has them.
//
// `virtual:media-editor` is the shared editor on a cloud build with the shared
// header, and a stub (every part null) everywhere else. The source clip editor
// asks once: with the parts it offers the link, the range and the crop before
// a clip is stored; without them it is the editor it always was.

import * as editor from "virtual:media-editor"
import type { MediaEditorParts } from "virtual:media-editor"

export function mediaEditorParts(): MediaEditorParts | null {
  if (!editor.mediaEditorAvailable) return null
  const { TrimPanel, CropPanel, RatioPicker, htmlMediaAdapter, defaultRange, clampRange, formatTime, fullRect, isWholeFrame } = editor
  if (!TrimPanel || !CropPanel || !RatioPicker || !htmlMediaAdapter || !defaultRange || !clampRange || !formatTime || !fullRect || !isWholeFrame) {
    return null
  }
  return { TrimPanel, CropPanel, RatioPicker, htmlMediaAdapter, defaultRange, clampRange, formatTime, fullRect, isWholeFrame }
}
