// @test-watches Dockerfile backend/src/*.ts
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Every process the image starts can delete storage objects: the API, the job
 * worker, the render worker, the orchestrator, the pipeline worker and the
 * plugin daemon host. On a deployment that deletes nothing (STORAGE_DELETES=skip)
 * each one logs, at boot, the line that says so and names itself, so an
 * operator can check every process before the deployment runs any job.
 *
 * The list is start.sh's own (`node dist/<name>.js` in the Dockerfile) and every
 * other top-level entry of backend/src (video-director runs in a container of
 * its own), so a process added either way fails here until it logs the line.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")
const dockerfile = readFileSync(resolve(ROOT, "Dockerfile"), "utf8")
const startSh = dockerfile.slice(dockerfile.indexOf("COPY <<'EOF' /app/start.sh"), dockerfile.indexOf("\nEOF\n"))
const started = [...new Set([...startSh.matchAll(/node dist\/([a-z-]+)\.js/g)].map((match) => match[1]))]
// Every top-level module of backend/src is a process entry, whether start.sh starts it or a deployment runs it in a
// container of its own (video-director), except the Fastify app the API processes build.
const NOT_A_PROCESS = new Set(["app"])
const entries = readdirSync(resolve(ROOT, "backend/src"))
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))
  .map((file) => file.replace(/\.ts$/, ""))
  .filter((name) => !NOT_A_PROCESS.has(name))
const processes = [...new Set([...started, ...entries])].sort()

describe("every process start.sh starts logs the storage-deletes boot line, naming itself", () => {
  it("start.sh starts the processes this test expects to find, and every one has an entry here", () => {
    expect(started).toEqual(expect.arrayContaining(["server", "worker", "render-worker", "orchestrator", "pipeline-worker", "plugin-daemons"]))
    expect(entries).toEqual(expect.arrayContaining(started))
    expect(entries).toContain("video-director")
  })

  for (const name of processes) {
    it(name, () => {
      const entry = readFileSync(resolve(ROOT, "backend/src", `${name}.ts`), "utf8")
      expect(entry).toContain(`logStorageDeletesAtBoot("${name}")`)
    })
  }
})
