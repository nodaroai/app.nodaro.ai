import { expect, test } from "vitest"
import { twice } from "./math.mjs"

// No snapshot is committed for this file: the harness must fail it, never write one.
test("a snapshot that does not exist", () => {
  expect(twice(2)).toMatchSnapshot()
})
