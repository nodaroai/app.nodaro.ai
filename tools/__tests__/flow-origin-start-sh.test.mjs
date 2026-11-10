import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

/**
 * The Flow host has one origin and two setting names: FLOW_UI_ORIGIN, read by
 * the bundled proxy and /config.js, and FLOW_PUBLIC_URL, read by the API for
 * the links it writes (docs/deployment.md). The API takes either name itself
 * (backend/src/lib/moved-pages-settings.ts :: movedFlowOrigin) and refuses to
 * start when both are set to different origins; the image's start.sh hands
 * FLOW_PUBLIC_URL to the proxy and the writer under the name they read, when
 * FLOW_UI_ORIGIN is unset. This runs start.sh's own line, taken from the
 * Dockerfile, under each combination.
 */

const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8")
const startSh = dockerfile.slice(dockerfile.indexOf("COPY <<'EOF' /app/start.sh"), dockerfile.indexOf("\nEOF\n"))
const lines = startSh.split("\n").filter((line) => !line.trimStart().startsWith("#") && line.includes("export FLOW_UI_ORIGIN="))

function flowUiOriginAfterStartSh(env) {
  const result = spawnSync("sh", ["-c", `${lines.join("\n")}\nprintf '%s' "\${FLOW_UI_ORIGIN-<unset>}"`], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

test("start.sh sets FLOW_UI_ORIGIN, in one line", () => {
  assert.equal(lines.length, 1, "start.sh has exactly one line exporting FLOW_UI_ORIGIN")
})

test("FLOW_PUBLIC_URL alone: the proxy and the writer read it as FLOW_UI_ORIGIN", () => {
  assert.equal(flowUiOriginAfterStartSh({ FLOW_PUBLIC_URL: "https://flow.example.com" }), "https://flow.example.com")
})

test("FLOW_UI_ORIGIN set: kept as given, whatever FLOW_PUBLIC_URL says (the API refuses a disagreement)", () => {
  assert.equal(flowUiOriginAfterStartSh({ FLOW_UI_ORIGIN: "https://flow.example.com/" }), "https://flow.example.com/")
  assert.equal(flowUiOriginAfterStartSh({ FLOW_UI_ORIGIN: "https://flow.example.com", FLOW_PUBLIC_URL: "https://other.example.com" }), "https://flow.example.com")
})

test("neither set: FLOW_UI_ORIGIN stays empty, the move stays off", () => {
  assert.ok(["", "<unset>"].includes(flowUiOriginAfterStartSh({})))
})
