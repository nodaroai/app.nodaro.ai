import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, delimiter, dirname, join } from "node:path"

/**
 * The shared site header reaches a build in exactly one place: the frontend
 * stage of the Dockerfile runs frontend/src/ee/shell/install-package.sh, which
 * installs the private package on a cloud build with VITE_SHARED_HEADER=true
 * and does nothing anywhere else. The script runs here against a fake `npm`
 * that records what it was asked and what .npmrc held at the time.
 */

const repo = new URL("../../", import.meta.url)
const SCRIPT = new URL("frontend/src/ee/shell/install-package.sh", repo).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const SH = process.env.SH_BIN ?? "sh"
const available = spawnSync(SH, ["-c", "exit 0"]).status === 0
const TOKEN = "test-token-not-real-0123456789"

function workspace({ nested = false, nestedPeer = "", npmFails = false, existingNpmrc = false, links = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "site-header-install-"))
  // The workspace's own @nodaro packages are links into packages/ (npm
  // workspaces), as after `npm ci`; the install must leave them that way.
  if (links) {
    for (const [name, target] of [["sdk", "client"], ["shared", "shared"]]) {
      mkdirSync(join(root, "packages", target), { recursive: true })
      mkdirSync(join(root, "node_modules", "@nodaro"), { recursive: true })
      symlinkSync(join(root, "packages", target), join(root, "node_modules", "@nodaro", name), "junction")
    }
  }
  const bin = join(root, ".bin")
  mkdirSync(bin)
  const log = join(root, "npm-call.txt")
  const seen = join(root, "npmrc-seen.txt")
  // The fake npm: records its argv and the .npmrc it found, optionally plants
  // a nested @nodaro copy, optionally fails.
  writeFileSync(
    join(bin, "npm"),
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" > '${log.replace(/\\/g, "/")}'`,
      `cat .npmrc > '${seen.replace(/\\/g, "/")}' 2>/dev/null || true`,
      nested ? "mkdir -p node_modules/@nodaroai/x/node_modules/@nodaro/sdk" : "",
      nestedPeer ? `mkdir -p node_modules/@nodaroai/x/node_modules/${nestedPeer}` : "",
      npmFails ? "exit 3" : "exit 0",
      "",
    ].join("\n"),
  )
  chmodSync(join(bin, "npm"), 0o755)
  if (existingNpmrc) writeFileSync(join(root, ".npmrc"), "registry=https://example.invalid\n")
  return { root, bin, log, seen }
}

function run(ws, env, { relative = false } = {}) {
  // relative: the script gets the root as a path relative to its working directory.
  const result = spawnSync(SH, [SCRIPT, relative ? basename(ws.root) : ws.root.replace(/\\/g, "/")], {
    cwd: relative ? dirname(ws.root) : undefined,
    encoding: "utf8",
    env: { PATH: `${ws.bin}${delimiter}${process.env.PATH}`, ...env },
  })
  return { ...result, output: `${result.stdout}${result.stderr}` }
}

const ON = { VITE_EDITION: "cloud", VITE_SHARED_HEADER: "true" }

test("community, business and a cloud build with the flag off: nothing is installed", { skip: !available }, () => {
  for (const env of [
    { VITE_EDITION: "community", VITE_SHARED_HEADER: "true", NPM_TOKEN: TOKEN },
    { VITE_EDITION: "business", VITE_SHARED_HEADER: "true", NPM_TOKEN: TOKEN },
    { VITE_EDITION: "cloud", NPM_TOKEN: TOKEN },
    {},
  ]) {
    const ws = workspace()
    try {
      const r = run(ws, env)
      assert.equal(r.status, 0, r.output)
      assert.equal(existsSync(ws.log), false, "npm must not run")
      assert.equal(existsSync(join(ws.root, ".npmrc")), false)
    } finally {
      rmSync(ws.root, { recursive: true, force: true })
    }
  }
})

test("cloud + flag without a token fails loudly and installs nothing", { skip: !available }, () => {
  const ws = workspace()
  try {
    const r = run(ws, ON)
    assert.notEqual(r.status, 0)
    assert.match(r.output, /needs NPM_TOKEN/)
    assert.equal(existsSync(ws.log), false)
  } finally {
    rmSync(ws.root, { recursive: true, force: true })
  }
})

test("cloud + flag + token: installs the pinned version without saving, with a temporary .npmrc, never printing the token", { skip: !available }, () => {
  const ws = workspace()
  try {
    const r = run(ws, { ...ON, NPM_TOKEN: TOKEN })
    assert.equal(r.status, 0, r.output)
    const args = readFileSync(ws.log, "utf8")
    assert.match(args, /^install --no-save --ignore-scripts --no-audit --no-fund @nodaroai\/[a-z-]+@\d+\.\d+\.\d+\s*$/)
    const npmrc = readFileSync(ws.seen, "utf8")
    assert.match(npmrc, /^@nodaroai:registry=https:\/\/npm\.pkg\.github\.com$/m)
    assert.match(npmrc, new RegExp(`^//npm\\.pkg\\.github\\.com/:_authToken=${TOKEN}$`, "m"))
    assert.equal(existsSync(join(ws.root, ".npmrc")), false, ".npmrc must be removed")
    assert.doesNotMatch(r.output, new RegExp(TOKEN))
  } finally {
    rmSync(ws.root, { recursive: true, force: true })
  }
})

test("an explicit version is honoured; a malformed one is refused", { skip: !available }, () => {
  const good = workspace()
  const bad = workspace()
  try {
    const r = run(good, { ...ON, NPM_TOKEN: TOKEN, SHARED_HEADER_PKG_VERSION: "9.8.7" })
    assert.equal(r.status, 0, r.output)
    assert.match(readFileSync(good.log, "utf8"), /@9\.8\.7\s*$/)
    const refused = run(bad, { ...ON, NPM_TOKEN: TOKEN, SHARED_HEADER_PKG_VERSION: "1.0.0 && echo pwned" })
    assert.notEqual(refused.status, 0)
    assert.equal(existsSync(bad.log), false)
  } finally {
    rmSync(good.root, { recursive: true, force: true })
    rmSync(bad.root, { recursive: true, force: true })
  }
})

test("a failed install still removes the .npmrc", { skip: !available }, () => {
  const ws = workspace({ npmFails: true })
  try {
    const r = run(ws, { ...ON, NPM_TOKEN: TOKEN })
    assert.notEqual(r.status, 0)
    assert.equal(existsSync(join(ws.root, ".npmrc")), false)
  } finally {
    rmSync(ws.root, { recursive: true, force: true })
  }
})

test("an existing .npmrc is left alone and the install refused", { skip: !available }, () => {
  const ws = workspace({ existingNpmrc: true })
  try {
    const r = run(ws, { ...ON, NPM_TOKEN: TOKEN })
    assert.notEqual(r.status, 0)
    assert.equal(readFileSync(join(ws.root, ".npmrc"), "utf8"), "registry=https://example.invalid\n")
    assert.equal(existsSync(ws.log), false)
  } finally {
    rmSync(ws.root, { recursive: true, force: true })
  }
})

test("a nested @nodaro copy under the private scope fails the install", { skip: !available }, () => {
  const ws = workspace({ nested: true })
  try {
    const r = run(ws, { ...ON, NPM_TOKEN: TOKEN })
    assert.notEqual(r.status, 0)
    assert.match(r.output, /nested @nodaro/)
  } finally {
    rmSync(ws.root, { recursive: true, force: true })
  }
})

test("a relative workspace root still gets its .npmrc removed", { skip: !available }, () => {
  const ws = workspace()
  try {
    const r = run(ws, { ...ON, NPM_TOKEN: TOKEN }, { relative: true })
    assert.equal(r.status, 0, r.output)
    assert.match(readFileSync(ws.seen, "utf8"), /_authToken=/)
    assert.equal(existsSync(join(ws.root, ".npmrc")), false)
  } finally {
    rmSync(ws.root, { recursive: true, force: true })
  }
})

test("only an exact version installs: a dist-tag or a range is refused", { skip: !available }, () => {
  for (const [version, ok] of [["0.2.1", true], ["1.0.0-beta.2", true], ["latest", false], ["^0.2.1", false], ["0.2", false], ["next", false]]) {
    const ws = workspace()
    try {
      const r = run(ws, { ...ON, NPM_TOKEN: TOKEN, SHARED_HEADER_PKG_VERSION: version })
      assert.equal(r.status === 0, ok, `${version}: ${r.output}`)
      assert.equal(existsSync(ws.log), ok, `${version}: npm must ${ok ? "" : "not "}run`)
    } finally {
      rmSync(ws.root, { recursive: true, force: true })
    }
  }
})

test("the workspace's own @nodaro links must survive the install", { skip: !available }, () => {
  const ws = workspace({ links: false })
  try {
    const r = run(ws, { ...ON, NPM_TOKEN: TOKEN })
    assert.notEqual(r.status, 0)
    assert.match(r.output, /workspace links/)
  } finally {
    rmSync(ws.root, { recursive: true, force: true })
  }
})

test("a nested react, react-dom or react-query copy under the private scope fails the install", { skip: !available }, () => {
  for (const peer of ["react", "react-dom", "@tanstack/react-query"]) {
    const ws = workspace({ nestedPeer: peer })
    try {
      const r = run(ws, { ...ON, NPM_TOKEN: TOKEN })
      assert.notEqual(r.status, 0, peer)
      assert.match(r.output, /nested/, peer)
    } finally {
      rmSync(ws.root, { recursive: true, force: true })
    }
  }
})

test("the token file is private to the build user, and removed on an interrupt too", () => {
  const script = readFileSync(SCRIPT, "utf8")
  assert.match(script, /umask 077/)
  assert.match(script, /^trap '[^']*\.npmrc[^']*' EXIT\s*$/m)
  assert.match(script, /^trap '[^']*\.npmrc[^']*exit 1' INT TERM HUP\s*$/m)
})

test("the Dockerfile runs the script in the frontend stage, before vite build, with the token only in its environment", () => {
  const dockerfile = readFileSync(new URL("Dockerfile", repo), "utf8")
  const stage = dockerfile.slice(dockerfile.indexOf("AS frontend-build"), dockerfile.indexOf("AS prod-deps"))
  assert.ok(stage.length > 0, "frontend-build stage not found")
  const install = stage.indexOf("RUN sh frontend/src/ee/shell/install-package.sh /app")
  const viteBuild = stage.indexOf("npx vite build")
  assert.ok(install > 0 && install < viteBuild, "the install must run before vite build, in the frontend stage")
  assert.match(stage, /^ARG NPM_TOKEN$/m)
  assert.match(stage, /^ARG SHARED_HEADER_PKG_VERSION$/m)
  assert.match(stage, /^ARG VITE_SHARED_HEADER$/m)
  assert.match(stage, /^ENV VITE_SHARED_HEADER=\$VITE_SHARED_HEADER$/m)
  // Railway logs RUN lines with build args substituted: no line may name the
  // token as $NPM_TOKEN / ${NPM_TOKEN} (only via $(printenv NPM_TOKEN)).
  for (const line of dockerfile.split("\n")) {
    if (/^\s*#/.test(line)) continue
    assert.doesNotMatch(line.replaceAll("$(printenv NPM_TOKEN)", ""), /\$\{?NPM_TOKEN\b/, line)
  }
  assert.doesNotMatch(dockerfile, /^ENV NPM_TOKEN/m)
})
