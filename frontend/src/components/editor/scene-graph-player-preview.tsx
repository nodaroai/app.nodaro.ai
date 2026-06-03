import { useMemo } from "react"
import { SceneGraphRenderer } from "@remotion-pkg/compositions/scene-graph-renderer"
import type { SceneGraph } from "@remotion-pkg/scene-graph"
import { RemotionPlayerPreview } from "./remotion-player-preview"

interface SceneGraphPlayerPreviewProps {
  sceneGraph: SceneGraph
}

/**
 * Phase 0 walking skeleton — embedded Remotion timeline. Plays a Story→Video
 * pipeline's assembled `SceneGraph` (scene composites laid end-to-end + audio
 * tracks) in-browser via the shared `<Player>` wrapper. Mirrors
 * `MotionGraphicsPlayerPreview` / `AfterEffectsPlayerPreview`.
 */
export function SceneGraphPlayerPreview({ sceneGraph }: SceneGraphPlayerPreviewProps) {
  const inputProps = useMemo(() => ({ sceneGraph }), [sceneGraph])

  return (
    <RemotionPlayerPreview
      component={SceneGraphRenderer}
      inputProps={inputProps}
      durationInFrames={sceneGraph.durationInFrames}
      fps={sceneGraph.fps}
      width={sceneGraph.width}
      height={sceneGraph.height}
    />
  )
}
