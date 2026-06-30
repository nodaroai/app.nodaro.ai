import { describe, it, expect, vi } from "vitest"

// Prevent @react-three/fiber's module-init reconciler from crashing
// (it calls React.ReactCurrentOwner which doesn't exist without react-dom)
vi.mock("@react-three/fiber", () => ({}))
vi.mock("@react-three/drei", () => ({ Points: vi.fn(), PointMaterial: vi.fn() }))
vi.mock("remotion", () => ({ useCurrentFrame: vi.fn(() => 0) }))

import { seededParticlePositions } from "../three-d-particles.js"

describe("seededParticlePositions", () => {
  it("is deterministic for the same inputs", () => {
    const a = seededParticlePositions(50, [10, 10, 10])
    const b = seededParticlePositions(50, [10, 10, 10])
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it("differs when inputs differ", () => {
    const a = seededParticlePositions(50, [10, 10, 10])
    const c = seededParticlePositions(50, [20, 10, 10])
    expect(Array.from(a)).not.toEqual(Array.from(c))
  })
})
