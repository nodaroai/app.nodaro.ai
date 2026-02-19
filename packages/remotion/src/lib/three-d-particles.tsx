import React, { useMemo, useRef } from "react"
import { useCurrentFrame } from "remotion"
import { Points, PointMaterial } from "@react-three/drei"
import * as THREE from "three"
import type { ParticleSystemObject } from "../plan-types"

/**
 * GPU-accelerated particle system with floating motion.
 * Uses Remotion's useCurrentFrame() — NOT r3f's useFrame().
 */
export function ParticleSystem({ object }: { object: ParticleSystemObject }) {
  const frame = useCurrentFrame()
  const pointsRef = useRef<THREE.Points>(null)

  const count = object.count
  const spread = object.spread

  // Generate initial random positions within spread bounds
  const initialPositions = useMemo(() => {
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * spread[0]
      positions[i * 3 + 1] = (Math.random() - 0.5) * spread[1]
      positions[i * 3 + 2] = (Math.random() - 0.5) * spread[2]
    }
    return positions
  }, [count, spread[0], spread[1], spread[2]])

  // Compute animated positions based on current frame
  const animatedPositions = useMemo(() => {
    const positions = new Float32Array(initialPositions.length)
    const time = frame * object.speed * 0.01

    for (let i = 0; i < count; i++) {
      const baseX = initialPositions[i * 3]
      const baseY = initialPositions[i * 3 + 1]
      const baseZ = initialPositions[i * 3 + 2]

      // Per-particle floating offsets using sine/cosine
      const phase = i * 0.1
      positions[i * 3] = baseX + Math.sin(time + phase) * 0.1
      positions[i * 3 + 1] = baseY + Math.cos(time * 0.7 + phase) * 0.15
      positions[i * 3 + 2] = baseZ + Math.sin(time * 0.5 + phase * 0.5) * 0.1
    }
    return positions
  }, [initialPositions, frame, object.speed, count])

  return (
    <Points ref={pointsRef} positions={animatedPositions} stride={3}>
      <PointMaterial
        transparent
        color={object.color}
        size={object.size}
        sizeAttenuation
        depthWrite={false}
        opacity={object.opacity}
      />
    </Points>
  )
}
