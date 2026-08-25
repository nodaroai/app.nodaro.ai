import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("examples/deploy-host.yml is valid YAML with the expected stages", () => {
  const text = readFileSync("examples/deploy-host.yml", "utf8")
  assert.match(text, /compose pull/)
  assert.match(text, /up -d/)
  assert.match(text, /curl .*\/health/) // health-gate
  assert.match(text, /image prune|system prune/) // prune
})

test("docs/deployment.md references the example", () => {
  assert.match(readFileSync("docs/deployment.md", "utf8"), /deploy-host\.yml/)
})
