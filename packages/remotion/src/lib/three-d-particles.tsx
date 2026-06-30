import React, { useMemo, useRef } from "react"
import { useCurrentFrame } from "remotion"
import { Points, PointMaterial } from "@react-three/drei"
import * as THREE from "three"
import type { ParticleSystemObject } from "../plan-types"

/**
 * Stable hash of input values using FNV-1a over their float32 bit patterns.
 * Returns a 32-bit unsigned integer seed.
 */
function stableHash(values: number[]): number {
  let h = 2166136261 >>> 0 // FNV-1a offset basis
  for (const v of values) {
    const buf = new Float32Array([v])
    const bits = new Uint32Array(buf.buffer)[0]
    h = Math.imul(h ^ bits, 16777619) >>> 0 // FNV-1a multiply
  }
  return h
}

/** Advance a Numerical Recipes LCG state in-place and return a value in [0, 1). */
function lcgNext(state: { s: number }): number {
  state.s = (Math.imul(1664525, state.s) + 1013904223) >>> 0
  return state.s / 0x100000000
}

/**
 * Generate a deterministic Float32Array of particle positions seeded from
 * the given count and spread values. Replacing Math.random() ensures
 * identical output across Remotion re-renders for the same props.
 */
export function seededParticlePositions(
  count: number,
  spread: [number, number, number],
): Float32Array {
  const seed = stableHash([count, spread[0], spread[1], spread[2]])
  const rng = { s: seed }
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (lcgNext(rng) - 0.5) * spread[0]
    positions[i * 3 + 1] = (lcgNext(rng) - 0.5) * spread[1]
    positions[i * 3 + 2] = (lcgNext(rng) - 0.5) * spread[2]
  }
  return positions
}

/**
 * GPU-accelerated particle system with floating motion.
 * Uses Remotion's useCurrentFrame() — NOT r3f's useFrame().
 */
export function ParticleSystem({ object }: { object: ParticleSystemObject }) {
  const frame = useCurrentFrame()
  const pointsRef = useRef<THREE.Points>(null)

  const count = object.count
  const spread = object.spread

  // Generate seeded deterministic positions within spread bounds
  const initialPositions = useMemo(
    () => seededParticlePositions(count, spread),
    [count, spread[0], spread[1], spread[2]],
  )

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
