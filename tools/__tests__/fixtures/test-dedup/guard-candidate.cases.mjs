import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const rules = JSON.parse(readFileSync(new URL("./rules.json", import.meta.url), "utf8"))

test("max stays 10", () => assert.equal(rules.max, 10))
test("exactly two names", () => assert.equal(rules.names.length, 2))
