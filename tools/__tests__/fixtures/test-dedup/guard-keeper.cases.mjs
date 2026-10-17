import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const rules = JSON.parse(readFileSync(new URL("./rules.json", import.meta.url), "utf8"))

test("max is at most 10", () => assert.ok(rules.max <= 10))
