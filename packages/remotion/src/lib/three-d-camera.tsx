import React from "react"
import { useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion"
import { useThree } from "@react-three/fiber"
import * as THREE from "three"
import type { ThreeDTitleCamera } from "../plan-types"

/**
 * Side-effect component that animates the Three.js camera.
 * Uses Remotion's useCurrentFrame() for frame-accurate rendering.
 * NEVER use useFrame() from r3f — Remotion controls frame advancement.
 */
export function AnimatedCamera({ camera }: { camera: ThreeDTitleCamera }) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const three = useThree()

  const cam = three.camera as THREE.PerspectiveCamera

  if (!camera.animation || camera.animation.type === "static") {
    cam.position.set(...camera.position)
    cam.lookAt(...camera.lookAt)
    cam.fov = camera.fov
    cam.updateProjectionMatrix()
    return null
  }

  const anim = camera.animation
  const totalFrames = durationInFrames

  const progress = getEasedProgress(frame, totalFrames, fps, anim.easing)

  if (anim.type === "dolly") {
    const x = interpolate(progress, [0, 1], [anim.startPosition[0], anim.endPosition[0]])
    const y = interpolate(progress, [0, 1], [anim.startPosition[1], anim.endPosition[1]])
    const z = interpolate(progress, [0, 1], [anim.startPosition[2], anim.endPosition[2]])
    cam.position.set(x, y, z)
  } else if (anim.type === "orbit") {
    const startAngle = Math.atan2(anim.startPosition[0], anim.startPosition[2])
    const endAngle = Math.atan2(anim.endPosition[0], anim.endPosition[2])
    const startRadius = Math.sqrt(anim.startPosition[0] ** 2 + anim.startPosition[2] ** 2)
    const endRadius = Math.sqrt(anim.endPosition[0] ** 2 + anim.endPosition[2] ** 2)

    const angle = interpolate(progress, [0, 1], [startAngle, endAngle])
    const radius = interpolate(progress, [0, 1], [startRadius, endRadius])
    const y = interpolate(progress, [0, 1], [anim.startPosition[1], anim.endPosition[1]])

    cam.position.set(Math.sin(angle) * radius, y, Math.cos(angle) * radius)
  }

  cam.lookAt(...camera.lookAt)
  cam.fov = camera.fov
  cam.updateProjectionMatrix()

  return null
}

function getEasedProgress(
  frame: number,
  totalFrames: number,
  fps: number,
  easing?: string,
): number {
  if (easing === "spring") {
    return spring({ frame, fps, config: { damping: 100, stiffness: 200 } })
  }

  const linear = interpolate(frame, [0, totalFrames - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  if (!easing || easing === "linear") return linear
  if (easing === "easeIn") return linear * linear
  if (easing === "easeOut") return 1 - (1 - linear) * (1 - linear)
  if (easing === "easeInOut") {
    return linear < 0.5
      ? 2 * linear * linear
      : 1 - Math.pow(-2 * linear + 2, 2) / 2
  }

  return linear
}
