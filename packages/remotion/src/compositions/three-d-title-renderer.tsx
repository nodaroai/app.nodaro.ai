import React, { Suspense } from "react"
import { AbsoluteFill, Img, Video } from "remotion"
import { ThreeCanvas } from "@remotion/three"
import { AnimatedCamera } from "../lib/three-d-camera"
import { AnimatedText3D } from "../lib/three-d-text"
import { ParticleSystem } from "../lib/three-d-particles"
import type { ThreeDTitlePlan } from "../plan-types"

interface ThreeDTitleRendererProps {
  plan: ThreeDTitlePlan
}

/**
 * Main Remotion composition for 3D Title rendering.
 * Uses @remotion/three's ThreeCanvas with explicit width/height.
 */
export function ThreeDTitleRenderer({ plan }: ThreeDTitleRendererProps) {
  const bgMedia = plan.backgroundMedia

  return (
    <AbsoluteFill style={{ backgroundColor: plan.backgroundColor }}>
      {/* Optional background media */}
      {bgMedia && isVideoUrl(bgMedia) && (
        <AbsoluteFill>
          <Video src={bgMedia} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </AbsoluteFill>
      )}
      {bgMedia && !isVideoUrl(bgMedia) && (
        <AbsoluteFill>
          <Img src={bgMedia} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </AbsoluteFill>
      )}

      {/* 3D scene */}
      <AbsoluteFill>
        <ThreeCanvas
          width={plan.width}
          height={plan.height}
          style={{ width: "100%", height: "100%" }}
          camera={{ fov: plan.camera.fov, position: plan.camera.position }}
        >
          <Suspense fallback={null}>
            {/* Camera controller */}
            <AnimatedCamera camera={plan.camera} />

            {/* Lighting */}
            <ambientLight
              intensity={plan.lighting.ambient.intensity}
              color={plan.lighting.ambient.color}
            />
            {plan.lighting.directional.map((light, i) => (
              <directionalLight
                key={`dir-${i}`}
                intensity={light.intensity}
                color={light.color}
                position={light.position}
              />
            ))}

            {/* Objects */}
            {plan.objects.map((obj) => {
              if (obj.type === "3d-text") {
                return <AnimatedText3D key={obj.id} object={obj} />
              }
              if (obj.type === "particle-system") {
                return <ParticleSystem key={obj.id} object={obj} />
              }
              return null
            })}
          </Suspense>
        </ThreeCanvas>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return lower.endsWith(".mp4") || lower.endsWith(".webm") || lower.endsWith(".mov")
}
