// tools/test-select/failed-files.mjs
// The test files a vitest JSON report marks failed, relative to the project
// directory — fed back to vitest for the one flake re-run on dev.
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export function failedFiles(report, cwd) {
  return (report.testResults ?? [])
    .filter((r) => r.status === "failed")
    .map((r) => path.relative(cwd, r.name).split(path.sep).join("/"))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = JSON.parse(readFileSync(process.argv[2], "utf8"))
  const out = failedFiles(report, process.cwd())
  if (out.length) process.stdout.write(`${out.join("\n")}\n`)
}
