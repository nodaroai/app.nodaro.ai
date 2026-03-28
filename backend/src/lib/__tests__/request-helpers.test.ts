import { describe, it, expect } from "vitest"
import {
  ACTIVE_EXECUTION_STATUSES,
  extractWorkflowId,
  extractForcePrivate,
  extractProvider,
} from "../request-helpers.js"

describe("request-helpers", () => {
  describe("ACTIVE_EXECUTION_STATUSES", () => {
    it("has 3 entries", () => {
      expect(ACTIVE_EXECUTION_STATUSES).toHaveLength(3)
    })

    it("contains pending, running, stopping", () => {
      expect(ACTIVE_EXECUTION_STATUSES).toContain("pending")
      expect(ACTIVE_EXECUTION_STATUSES).toContain("running")
      expect(ACTIVE_EXECUTION_STATUSES).toContain("stopping")
    })
  })

  describe("extractWorkflowId", () => {
    it("returns the workflowId when present and a non-empty string", () => {
      expect(extractWorkflowId({ workflowId: "abc" })).toBe("abc")
    })

    it("returns null for empty string", () => {
      expect(extractWorkflowId({ workflowId: "" })).toBeNull()
    })

    it("returns null when value is not a string", () => {
      expect(extractWorkflowId({ workflowId: 123 })).toBeNull()
    })

    it("returns null when key is missing", () => {
      expect(extractWorkflowId({})).toBeNull()
    })

    it("returns null for null body", () => {
      expect(extractWorkflowId(null)).toBeNull()
    })

    it("returns null for undefined body", () => {
      expect(extractWorkflowId(undefined)).toBeNull()
    })

    it("returns null for string body", () => {
      expect(extractWorkflowId("string")).toBeNull()
    })
  })

  describe("extractForcePrivate", () => {
    it("returns true when forcePrivate is true", () => {
      expect(extractForcePrivate({ forcePrivate: true })).toBe(true)
    })

    it("returns false when forcePrivate is false", () => {
      expect(extractForcePrivate({ forcePrivate: false })).toBe(false)
    })

    it("returns false when forcePrivate is the string 'true'", () => {
      expect(extractForcePrivate({ forcePrivate: "true" })).toBe(false)
    })

    it("returns false when key is missing", () => {
      expect(extractForcePrivate({})).toBe(false)
    })

    it("returns false for null body", () => {
      expect(extractForcePrivate(null)).toBe(false)
    })
  })

  describe("extractProvider", () => {
    it("returns the provider when present and a non-empty string", () => {
      expect(extractProvider({ provider: "flux" }, "default")).toBe("flux")
    })

    it("returns the fallback for empty string", () => {
      expect(extractProvider({ provider: "" }, "default")).toBe("default")
    })

    it("returns the fallback when value is not a string", () => {
      expect(extractProvider({ provider: 123 }, "default")).toBe("default")
    })

    it("returns the fallback when key is missing", () => {
      expect(extractProvider({}, "fallback")).toBe("fallback")
    })

    it("returns the fallback for null body", () => {
      expect(extractProvider(null, "fallback")).toBe("fallback")
    })
  })
})
