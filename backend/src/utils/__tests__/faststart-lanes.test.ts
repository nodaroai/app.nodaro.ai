/**
 * A lane that stores a user's video bytes and skips the faststart rewrite is a
 * silent regression: nothing fails, the file is just stored moov-last again.
 * This pins the lanes that existed when the rewrite landed (the behaviour of
 * each is exercised in routes/__tests__/upload-faststart.test.ts and
 * lib/__tests__/media-url-import.test.ts).
 *
 * Deliberately NOT covered, and why:
 *  - routes/telegram-webhook.ts stores a video a Telegram bot message carried
 *    (already re-encoded for messaging, a bot ingestion rather than an upload);
 *  - lib/retained-videos.ts keeps video a workflow or plugin captured (job
 *    outputs, R2 copies) and every provider result stores media WE produced, not
 *    a user's file;
 *  - routes/media-process.ts (a cut WE render from a stored file) and the
 *    YouTube lane (already muxed with +faststart).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8")

describe("faststart covers every lane that stores a user's video", () => {
  const buffered: Array<[string, string]> = [
    ["routes/upload.ts", "faststartVideoBuffer("],
    ["routes/upload-proxy.ts", "faststartVideoBuffer("],
    ["routes/upload-handoff.ts", "faststartVideoBuffer("],
    ["lib/media-url-import.ts", "faststartVideoFile("],
  ]

  it.each(buffered)("%s rewrites before it stores", (file, call) => {
    expect(read(file)).toContain(call)
  })

  it.each([
    ["routes/upload.ts", "applyUploadPolicies({\n      kind: uploadKindFromMime(mimeTypeFinal),\n      lane: \"upload\""],
    ["routes/upload-proxy.ts", "applyUploadPolicies({"],
    ["routes/upload-handoff.ts", "applyUploadPolicies({"],
    ["lib/media-url-import.ts", "const postDecision = await applyUploadPolicies("],
  ])("%s rewrites BEFORE the upload policy sees the bytes", (file, policyCall) => {
    const src = read(file)
    const rewrite = Math.min(...["faststartVideoBuffer(", "faststartVideoFile("].map((c) => src.indexOf(c)).filter((i) => i >= 0))
    const policy = src.indexOf(policyCall)
    expect(rewrite).toBeGreaterThan(-1)
    expect(policy).toBeGreaterThan(-1)
    expect(rewrite).toBeLessThan(policy)
  })
})
