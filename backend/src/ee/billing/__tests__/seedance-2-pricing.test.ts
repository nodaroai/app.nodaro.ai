import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS } from "../credits.js"

describe("seedance-2 4k + 1080p static credits", () => {
  const expected: Record<string, number> = {
    "seedance-2:4s:4k": 208, "seedance-2:8s:4k": 416, "seedance-2:12s:4k": 624, "seedance-2:15s:4k": 780,
    "seedance-2:4s:4k-ref": 128, "seedance-2:8s:4k-ref": 256, "seedance-2:12s:4k-ref": 384, "seedance-2:15s:4k-ref": 480,
    "seedance-2:4s:1080p": 102, "seedance-2:8s:1080p": 204, "seedance-2:12s:1080p": 306, "seedance-2:15s:1080p": 383,
    "seedance-2:4s:1080p-ref": 62, "seedance-2:8s:1080p-ref": 124, "seedance-2:12s:1080p-ref": 186, "seedance-2:15s:1080p-ref": 233,
  }
  for (const [id, credits] of Object.entries(expected)) {
    it(`${id} = ${credits}`, () => { expect(STATIC_CREDIT_COSTS[id]).toBe(credits) })
  }
})
