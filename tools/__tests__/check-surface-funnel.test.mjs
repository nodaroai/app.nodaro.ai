import { test } from "node:test"
import assert from "node:assert/strict"
import { findSurfaceFunnelViolations } from "../check-surface-funnel.mjs"

test("flags a raw product-name literal in a chrome component", () => {
  const violations = findSurfaceFunnelViolations([
    { path: "frontend/src/components/fake-header.tsx", text: `export const T = "Nodaro.ai"` },
  ])
  assert.equal(violations.length, 1)
})

test("passes a component that reads surfaceBrandName()", () => {
  const violations = findSurfaceFunnelViolations([
    { path: "frontend/src/components/fake-header.tsx", text: `import { surfaceBrandName } from "@/lib/surface-selectors"` },
  ])
  assert.equal(violations.length, 0)
})

test("ignores the surface source files themselves (substring pre-filter)", () => {
  const violations = findSurfaceFunnelViolations([
    { path: "frontend/src/lib/surface-profile.ts", text: `productName: "Nodaro"` },
  ])
  assert.equal(violations.length, 0)
})
