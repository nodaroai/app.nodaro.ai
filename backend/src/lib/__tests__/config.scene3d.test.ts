import { describe, expect, it } from "vitest"
import { envSchema } from "../config.js"

describe("Scene3D feature flags", () => {
  for (const name of ["SCENE3D_ADVANCED_ENABLED", "SCENE3D_LOCAL_ENABLED"] as const) {
    it(`${name} is opt-in and does not treat the string false as enabled`, () => {
      const schema = envSchema.shape[name]
      expect(schema.parse(undefined)).toBe(false)
      for (const value of ["false", "0", "", "TRUE"]) expect(schema.parse(value)).toBe(false)
      for (const value of ["true", "1"]) expect(schema.parse(value)).toBe(true)
    })
  }
})
