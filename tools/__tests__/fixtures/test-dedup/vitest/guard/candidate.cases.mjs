import { readFileSync } from "node:fs"
import { expect, test } from "vitest"

const rules = JSON.parse(readFileSync(new URL("./rules.json", import.meta.url), "utf8"))

test("max stays 10", () => expect(rules.max).toBe(10))

// Names built from data: a seed that renames one must still count when it fails.
for (const name of rules.names) test(`name ${name}`, () => expect(name).toHaveLength(1))
