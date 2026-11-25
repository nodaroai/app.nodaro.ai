import { dirname } from "node:path"
import { smartLoopCut, type SmartLoopCutOptions } from "./smart-loop-cut.js"

/** A video kept on local disk between two steps: its file, and the folder to remove once it is stored. */
export interface LocalVideo {
  readonly path: string
  readonly dir: string
}

/** Apply smart-loop-cut as a post-process to a video URL and keep the result
 *  on LOCAL disk (decided 2026-11-22): the step after it (the store, a merge)
 *  reads the file directly, so no intermediate copy is ever stored — on a
 *  watermarked run it would be the unwatermarked picture, and nothing would
 *  name it for a sweep. The caller removes `dir` once it is done with it.
 *
 *  Used by the i2v worker handler to replace the legacy VEO-only fixed
 *  8-frame trim. Throws on failure — caller is responsible for keeping
 *  the original URL and refunding the addon. */
export async function applySmartLoopCutLocal(
  videoUrl: string,
  options: Omit<SmartLoopCutOptions, "videoUrl">,
): Promise<LocalVideo> {
  const slc = await smartLoopCut({ videoUrl, ...options })
  return { path: slc.videoPath, dir: dirname(slc.videoPath) }
}
