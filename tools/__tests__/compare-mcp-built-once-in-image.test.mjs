// @test-watches Dockerfile .dockerignore backend/tsconfig.build.json backend/src/scripts/compare-mcp-built-once.ts backend/src/scripts/lib/staging-only.ts docs/deployment.md
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"

/**
 * The staging-only MCP comparison (backend/src/scripts/compare-mcp-built-once.ts)
 * runs inside a deployed container, whose image carries the backend only as
 * compiled `backend/dist` (no `src/`, and of `scripts/` only the migration
 * runner). So it lives under `src/`, the build compiles it to
 * `dist/scripts/compare-mcp-built-once.js`, and it runs there with plain
 * `node`; its relative imports are the same in `src/` and in `dist/`.
 * This fails when the image would stop carrying it, when its command drifts
 * between its header and the deployment guide, or when it would load anything
 * but its staging-only check before refusing.
 */
const root = new URL("../../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")

const SCRIPT = "backend/src/scripts/compare-mcp-built-once.ts"
const COMMAND = "cd /app/backend && MCP_COMPARE_STAGING_HOST=<PUBLIC_URL's host> node dist/scripts/compare-mcp-built-once.js"

test("the backend build compiles the script into dist/scripts/", () => {
  const build = JSON.parse(read("backend/tsconfig.build.json"))
  assert.equal(build.compilerOptions.rootDir, "./src", "dist mirrors src, so the script lands at dist/scripts/")
  assert.ok(build.include.includes("src/**/*"), "the build includes all of src")
  for (const pattern of build.exclude) assert.doesNotMatch(pattern, /scripts/, `the build must not exclude the script (${pattern})`)
  assert.ok(existsSync(new URL(SCRIPT, root)))
})

test("the image builds the backend with that config and carries its whole dist", () => {
  // The build context keeps the script (a pattern naming backend/src or a scripts folder would drop it before tsc runs).
  for (const line of read(".dockerignore").split("\n").map((l) => l.trim())) {
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue
    assert.doesNotMatch(line, /backend\/src|scripts|^\*\*\/\*\.ts$/, `.dockerignore must not drop the script (${line})`)
  }
  const dockerfile = read("Dockerfile")
  assert.match(dockerfile, /RUN [^\n]*tsc -p tsconfig\.build\.json/)
  assert.match(dockerfile, /^COPY [^\n]*--from=backend-build \/app\/backend\/dist \.\/backend\/dist$/m)
})

test("its header and the deployment guide give the same command", () => {
  assert.ok(read(SCRIPT).includes(COMMAND), "the script's header")
  assert.ok(read("docs/deployment.md").includes(COMMAND), "docs/deployment.md")
})

test("it loads nothing but its staging-only check before it refuses, and its later imports resolve from src/ (and so from dist/)", () => {
  const text = read(SCRIPT)
  const statics = [...text.matchAll(/^import\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1])
  assert.deepEqual(statics.sort(), ["./lib/staging-only.js", "dotenv/config"])
  assert.doesNotMatch(read("backend/src/scripts/lib/staging-only.ts"), /^import\s/m, "the check itself imports nothing")
  const refusal = text.indexOf("stagingOnlyRefusal(process.env)")
  const dynamics = [...text.matchAll(/await import\("([^"]+)"\)/g)]
  const relative = dynamics.filter((m) => m[1].startsWith("."))
  assert.ok(relative.length > 0)
  for (const m of relative) {
    assert.ok(m.index > refusal, `${m[1]} is loaded after the check`)
    assert.ok(existsSync(new URL(m[1].replace(/\.js$/, ".ts"), new URL(SCRIPT, root))), `${m[1]} resolves next to the script`)
  }
})
