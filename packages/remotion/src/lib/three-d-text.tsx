import React, { Suspense, useMemo } from "react"
import { useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion"
import { Center, Text3D } from "@react-three/drei"
import * as THREE from "three"
import { resolve3DFontPath } from "./three-d-font-registry"
import type { ThreeDTextObject } from "../plan-types"

function buildMaterial(mat: ThreeDTextObject["material"]): THREE.Material {
  const color = new THREE.Color(mat.color)

  switch (mat.type) {
    case "metallic":
      return new THREE.MeshStandardMaterial({
        color,
        metalness: mat.metalness ?? 0.9,
        roughness: mat.roughness ?? 0.1,
      })
    case "glass":
      return new THREE.MeshPhysicalMaterial({
        color,
        metalness: mat.metalness ?? 0.0,
        roughness: mat.roughness ?? 0.05,
        transmission: 0.9,
        ior: 1.5,
        transparent: true,
      })
    case "emissive":
      return new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: mat.emissiveIntensity ?? 2.0,
        metalness: mat.metalness ?? 0.3,
        roughness: mat.roughness ?? 0.4,
      })
    case "standard":
    default:
      return new THREE.MeshStandardMaterial({
        color,
        metalness: mat.metalness ?? 0.3,
        roughness: mat.roughness ?? 0.6,
      })
  }
}

/**
 * Animated Text3D mesh with material system and entry animations.
 * Uses Remotion's useCurrentFrame() for frame-accurate animation.
 */
export function AnimatedText3D({ object }: { object: ThreeDTextObject }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const fontPath = resolve3DFontPath(object.font)
  const material = useMemo(() => buildMaterial(object.material), [object.material])

  const anim = object.animation
  const animProgress = getAnimProgress(frame, anim.startFrame, anim.durationFrames, fps, anim.easing)

  // Compute animated transforms
  let rotation: [number, number, number] = [0, 0, 0]
  let scale: [number, number, number] = [1, 1, 1]
  let opacity = 1
  const position: [number, number, number] = [...object.position]

  switch (anim.type) {
    case "rotate-in": {
      const axis = anim.axis ?? "y"
      const angle = interpolate(animProgress, [0, 1], [Math.PI, 0])
      if (axis === "x") rotation = [angle, 0, 0]
      else if (axis === "y") rotation = [0, angle, 0]
      else rotation = [0, 0, angle]
      break
    }
    case "scale-up": {
      const s = interpolate(animProgress, [0, 1], [0, 1])
      scale = [s, s, s]
      break
    }
    case "fade-in": {
      opacity = interpolate(animProgress, [0, 1], [0, 1])
      break
    }
    case "slide-in": {
      const axis = anim.axis ?? "y"
      const offset = interpolate(animProgress, [0, 1], [3, 0])
      if (axis === "x") position[0] += offset
      else if (axis === "y") position[1] += offset
      else position[2] += offset
      break
    }
    case "none":
    default:
      break
  }

  // Handle fade-in by cloning material with transparency
  const finalMaterial = useMemo(() => {
    if (anim.type !== "fade-in") return material
    const cloned = material.clone()
    ;(cloned as THREE.MeshStandardMaterial).transparent = true
    return cloned
  }, [material, anim.type])

  if (anim.type === "fade-in") {
    ;(finalMaterial as THREE.MeshStandardMaterial).opacity = opacity
  }

  return (
    <Suspense fallback={null}>
      <group position={position} rotation={rotation} scale={scale}>
        <Center>
          <Text3D
            font={fontPath}
            size={object.size}
            height={object.depth}
            bevelEnabled
            bevelSize={0.02}
            bevelThickness={0.01}
          >
            {object.text}
            <primitive object={finalMaterial} attach="material" />
          </Text3D>
        </Center>
      </group>
    </Suspense>
  )
}

function getAnimProgress(
  frame: number,
  startFrame: number,
  durationFrames: number,
  fps: number,
  easing?: string,
): number {
  if (frame < startFrame) return 0
  if (frame >= startFrame + durationFrames) return 1

  const localFrame = frame - startFrame

  if (easing === "spring") {
    return spring({
      frame: localFrame,
      fps,
      config: { damping: 100, stiffness: 200 },
      durationInFrames: durationFrames,
    })
  }

  return interpolate(localFrame, [0, durationFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
}
