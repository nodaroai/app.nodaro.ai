import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readdirSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The production ffmpeg is the patched static build published by
 * https://github.com/nodaroai/ffmpeg-static (public; the build, the patch and the
 * source offer live there and nowhere else). The Dockerfile pins one release by URL
 * and sha256; this file pins that the pin is coherent everywhere it is repeated, that
 * nothing still points at the old prebuilt, that no second copy of the build drifts
 * in this repository, and that the image gets the licence files that ship with the
 * binary (tools/install-pinned-ffmpeg.sh).
 */
const root = rel => new URL(`../../${rel}`, import.meta.url)
const read = rel => readFileSync(root(rel), "utf8")
const dockerfile = read("Dockerfile")
const arg = name => dockerfile.match(new RegExp(`^ARG ${name}=(.*)$`, "m"))?.[1]

const TAG = /^n\d+\.\d+(?:\.\d+)?-\d+-g[0-9a-f]{10}-\d{8}-nodaro\d+$/

test("the Dockerfile pins a ffmpeg-static release, by URL and sha256, for both architectures", () => {
  const tags = new Set()
  for (const [suffix, target] of [["AMD64", "linux64"], ["ARM64", "linuxarm64"]]) {
    const url = arg(`FFMPEG_TARBALL_URL_${suffix}`)
    const m = url?.match(new RegExp(`^https://github\\.com/nodaroai/ffmpeg-static/releases/download/([^/]+)/ffmpeg-(n[\\d.]+-\\d+-g[0-9a-f]+)-${target}-gpl-8\\.1-nodaro(\\d+)\\.tar\\.xz$`))
    assert.ok(m, `${suffix}: ${url}`)
    assert.match(m[1], TAG, "the release tag is <describe>-<date>-nodaro<N>")
    assert.equal(m[1], `${m[2]}-${m[1].split("-").slice(-2).join("-")}`, "the tag and the file name agree")
    tags.add(m[1])
    assert.match(arg(`FFMPEG_TARBALL_SHA256_${suffix}`) ?? "", /^[0-9a-f]{64}$/)
  }
  assert.equal(tags.size, 1, "both architectures come from one release")
})

test("the version the goldens and the banner fixture name is the pinned release's version", () => {
  const tag = arg("FFMPEG_TARBALL_URL_AMD64").match(/download\/([^/]+)\//)[1]
  const golden = JSON.parse(read("backend/src/providers/video/__characterization__/golden/ffmpeg-n8.1.2.json"))
  assert.equal(golden.ffmpegVersion, tag)
  assert.match(read("backend/src/providers/video/__tests__/ffmpeg-utils.test.ts"), new RegExp(`ffmpeg version ${tag.replace(/\./g, "\\.")} Copyright`))
})

test("nothing in the repository still pins the old prebuilt or carries a second copy of the build", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: fileURLToPath(root("")), encoding: "utf8" }).split("\0").filter(Boolean)
  const self = "tools/__tests__/ffmpeg-pin.test.mjs"
  const old = /BtbN|autobuild-2026|0ba73bbd|d3f90a71/
  const hits = files.filter(f => f !== self && !/package-lock\.json$/.test(f) && existsSync(root(f)) && old.test(readFileSync(root(f), "utf8")))
  assert.deepEqual(hits, [], "files still naming the old prebuilt")
  assert.deepEqual(files.filter(f => f.startsWith("tools/ffmpeg-build/") || f === ".github/workflows/ffmpeg-build.yml"), [], "the build lives in ffmpeg-static only")
})

test("every consumer of the pin goes through the one install script", () => {
  assert.match(read(".github/workflows/ci.yml"), /install-pinned-ffmpeg\.sh --from-dockerfile Dockerfile --arch amd64/)
  assert.match(read("backend/scripts/characterize-in-image.sh"), /install-pinned-ffmpeg\.sh --from-dockerfile/)
  assert.match(dockerfile, /install-pinned-ffmpeg\.sh --url/)
})

// --- the install script copies the licences next to the binary ----------------------

const installer = fileURLToPath(root("tools/install-pinned-ffmpeg.sh"))
function tarballFixture({ licenses = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pin-"))
  const top = join(dir, "src", "ffmpeg-x-linux64")
  mkdirSync(join(top, "bin"), { recursive: true })
  for (const b of ["ffmpeg", "ffprobe"]) {
    writeFileSync(join(top, "bin", b), "#!/bin/sh\necho 'ffmpeg version fixture'\n")
    chmodSync(join(top, "bin", b), 0o755)
  }
  writeFileSync(join(top, "LICENSE.txt"), "GPL text\n")
  writeFileSync(join(top, "SOURCE.txt"), "built from ...\n")
  writeFileSync(join(top, "LINK-TRACE.txt"), "built\tx264\tx264-abc.tar\tx264\n")
  if (licenses) {
    mkdirSync(join(top, "LICENSES", "x264"), { recursive: true })
    writeFileSync(join(top, "LICENSES", "x264", "COPYING"), "x264 licence\n")
    writeFileSync(join(top, "LICENSES", "README.txt"), "index\n")
  }
  const tar = join(dir, "ffmpeg.tar.xz")
  execFileSync("tar", ["-cf", tar, "-C", join(dir, "src"), "ffmpeg-x-linux64"])
  const sha = createHash("sha256").update(readFileSync(tar)).digest("hex")
  return { dir, tar, sha }
}
const install = (f, env = {}) => spawnSync("bash", [installer, "--url", `file://${f.tar}`, "--sha256", f.sha], {
  encoding: "utf8",
  env: { ...process.env, FFMPEG_BIN_DIR: join(f.dir, "usr/bin"), FFMPEG_DOC_DIR: join(f.dir, "usr/doc/ffmpeg-static"), ...env },
})

test("install-pinned-ffmpeg.sh installs the binaries and copies LICENSE, SOURCE and LICENSES beside them", () => {
  const f = tarballFixture()
  const r = install(f)
  assert.equal(r.status, 0, r.stderr)
  const doc = join(f.dir, "usr/doc/ffmpeg-static")
  assert.equal(readFileSync(join(doc, "LICENSE"), "utf8"), "GPL text\n")
  assert.equal(readFileSync(join(doc, "SOURCE"), "utf8"), "built from ...\n")
  assert.equal(readFileSync(join(doc, "LICENSES/x264/COPYING"), "utf8"), "x264 licence\n")
  assert.ok(existsSync(join(doc, "LINK-TRACE.txt")))
  assert.deepEqual(readdirSync(join(f.dir, "usr/bin")).sort(), ["ffmpeg", "ffprobe"])
  assert.match(r.stdout, /ffmpeg version fixture/)
  rmSync(f.dir, { recursive: true, force: true })
})

test("install-pinned-ffmpeg.sh refuses a tarball without its licences, and installs nothing", () => {
  const f = tarballFixture({ licenses: false })
  const r = install(f)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /no LICENSES/)
  assert.ok(!existsSync(join(f.dir, "usr/bin/ffmpeg")), "no binary without its licences")
  rmSync(f.dir, { recursive: true, force: true })
})

test("install-pinned-ffmpeg.sh still refuses a checksum mismatch", () => {
  const f = tarballFixture()
  const r = install({ ...f, sha: "0".repeat(64) })
  assert.notEqual(r.status, 0)
  assert.ok(!existsSync(join(f.dir, "usr/bin/ffmpeg")))
  rmSync(f.dir, { recursive: true, force: true })
})

test("the image keeps the licences where the script puts them", () => {
  assert.match(read("tools/install-pinned-ffmpeg.sh"), /\/usr\/local\/share\/doc\/ffmpeg-static/)
})
