import { expect, test } from "vitest"
import { one } from "./one.mjs"

test("the worker is told coverage is on", () => {
  expect(process.env.TEST_DEDUP_UNDER_COVERAGE).toBe("1")
  expect(one()).toBe(1)
})
