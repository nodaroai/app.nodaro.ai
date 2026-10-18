import { readFileSync } from "node:fs"
import { expect, test } from "vitest"

const rules = JSON.parse(readFileSync(new URL("./rules.json", import.meta.url), "utf8"))

// With "hang" seeded this keeper never finishes: it times out, which is no catch.
test("max is at most 10", async () => {
  if (rules.hang) await new Promise(() => {})
  expect(rules.max).toBeLessThanOrEqual(10)
}, 300)
