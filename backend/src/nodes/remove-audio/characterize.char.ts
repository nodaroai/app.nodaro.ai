import { dirname } from "node:path"
import { removeAudio } from "../../providers/video/remove-audio.js"
import { fixtureUrl } from "../../providers/video/__characterization__/fixtures.js"
import type { UnitCharacterization } from "../../providers/video/__characterization__/operation-types.js"
import { descriptor } from "./descriptor.generated.js"

// The ffmpeg characterization of this node (backend/src/providers/video/__characterization__/):
// the harness names it by the unit's type, its golden key, and runs it after the split-media ops.
export const characterization: UnitCharacterization = {
  after: "split-media-video-parts",
  tier: 3,
  run: async (f) => {
    const { videoPath } = await removeAudio({ videoUrl: fixtureUrl(f.clipMp4), workDirPrefix: descriptor.type })
    return { outputs: [{ label: "out", path: videoPath, kind: "video" }], cleanupDirs: [dirname(videoPath)] }
  },
}
