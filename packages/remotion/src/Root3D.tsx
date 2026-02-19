/**
 * Separate Remotion entry point for 3D compositions.
 *
 * @react-three/fiber creates its own React reconciler at module load time,
 * which conflicts with Remotion's reconciler and crashes ALL compositions
 * in the same bundle. This isolated entry point ensures r3f only loads
 * when rendering 3D title compositions.
 */
import React from "react"
import { Composition, registerRoot } from "remotion"
import { ThreeDTitleRenderer } from "./compositions/three-d-title-renderer"
import type { ThreeDTitlePlan } from "./plan-types"

const THREE_D_TITLE_DEFAULT_PROPS: { plan: ThreeDTitlePlan } = {
  plan: {
    planType: "3d-title",
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    backgroundColor: "#000000",
    camera: {
      fov: 75,
      position: [0, 0, 5],
      lookAt: [0, 0, 0],
    },
    lighting: {
      ambient: { intensity: 0.5, color: "#ffffff" },
      directional: [{ intensity: 1, color: "#ffffff", position: [5, 5, 5] }],
    },
    objects: [],
  },
}

function Root3D() {
  return (
    <Composition
      id="3d-title"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      component={ThreeDTitleRenderer as React.FC<any>}
      durationInFrames={300}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={THREE_D_TITLE_DEFAULT_PROPS}
    />
  )
}

registerRoot(Root3D)
