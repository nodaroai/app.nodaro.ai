import { describe, expect, it } from "vitest"
import {
  compareVersions,
  declaredInPackageJson,
  isExactVersion,
  latestRelease,
  packageNameOf,
  parseSiteFile,
  versionFromLockfile,
  versionFromPin,
} from "../read-version.js"

const PKG = "@acme/header"

describe("packageNameOf", () => {
  it("reads the name a manifest gives its package", () => {
    expect(packageNameOf(JSON.stringify({ name: PKG, version: "0.13.0" }))).toBe(PKG)
    expect(packageNameOf(JSON.stringify({ version: "0.13.0" }))).toBeNull()
    expect(packageNameOf("not json")).toBeNull()
  })
})

describe("versionFromLockfile", () => {
  it("reads the installed version from a v2/v3 lockfile's packages map", () => {
    const lock = { lockfileVersion: 3, packages: { "": { name: "tools" }, "node_modules/@acme/header": { version: "0.12.0" } } }
    expect(versionFromLockfile(JSON.stringify(lock), PKG)).toBe("0.12.0")
    // Another package's entry is not the header's.
    expect(versionFromLockfile(JSON.stringify(lock), "@acme/other")).toBeNull()
  })

  it("falls back to a v1 lockfile's dependencies map", () => {
    expect(versionFromLockfile(JSON.stringify({ lockfileVersion: 1, dependencies: { "@acme/header": { version: "0.6.2" } } }), PKG)).toBe("0.6.2")
  })

  it("is null for a lockfile without the header, a range, or text that is not JSON", () => {
    expect(versionFromLockfile(JSON.stringify({ packages: { "node_modules/react": { version: "18.3.1" } } }), PKG)).toBeNull()
    expect(versionFromLockfile(JSON.stringify({ packages: { "node_modules/@acme/header": { version: "^0.12.0" } } }), PKG)).toBeNull()
    expect(versionFromLockfile("<!doctype html>", PKG)).toBeNull()
    expect(versionFromLockfile("", PKG)).toBeNull()
  })
})

describe("declaredInPackageJson", () => {
  it("answers what the manifest declares, a range included", () => {
    expect(declaredInPackageJson(JSON.stringify({ dependencies: { "@acme/header": "^0.12.0" } }), PKG)).toBe("^0.12.0")
    expect(declaredInPackageJson(JSON.stringify({ devDependencies: { "@acme/header": "0.13.0" } }), PKG)).toBe("0.13.0")
    expect(declaredInPackageJson(JSON.stringify({ dependencies: { react: "18.3.1" } }), PKG)).toBeNull()
    expect(declaredInPackageJson("not json", PKG)).toBeNull()
  })
})

describe("versionFromPin", () => {
  it("reads the PIN line of install-package.sh, exact versions only", () => {
    expect(versionFromPin('set -eu\n\nPIN="0.12.0"\nVERSION="${SHARED_HEADER_PKG_VERSION:-$PIN}"\n')).toBe("0.12.0")
    expect(versionFromPin('PIN="latest"\n')).toBeNull()
    expect(versionFromPin('  PIN="0.12.0"\n')).toBeNull()
    expect(versionFromPin("")).toBeNull()
  })
})

describe("parseSiteFile", () => {
  it("reads what the site published, the header on or off", () => {
    expect(parseSiteFile('{"package":"@acme/header","version":"0.12.0","header":true}')).toEqual({ version: "0.12.0", header: true })
    expect(parseSiteFile('{"version":"0.12.0","header":false}')).toEqual({ version: "0.12.0", header: false })
    expect(parseSiteFile('{"version":null,"header":false}')).toEqual({ version: null, header: false })
  })

  it("is null for a site that answers its HTML shell, or a malformed file", () => {
    expect(parseSiteFile("<!doctype html><title>Nodaro.ai</title>")).toBeNull()
    expect(parseSiteFile('{"version":"0.12.0"}')).toBeNull()
    expect(parseSiteFile('{"version":"latest","header":true}')).toBeNull()
  })
})

describe("latestRelease", () => {
  it("is the highest release tag, by number rather than by text", () => {
    expect(latestRelease(["v0.9.0", "v0.13.0", "v0.12.0", "v0.10.0"])).toBe("0.13.0")
    expect(latestRelease(["v1.0.0-rc.1", "v0.13.0", "nightly"])).toBe("0.13.0")
    expect(latestRelease([])).toBeNull()
  })
})

describe("compareVersions / isExactVersion", () => {
  it("orders by each number, a release after its pre-release", () => {
    expect(compareVersions("0.13.0", "0.9.9")).toBeGreaterThan(0)
    expect(compareVersions("0.12.0", "0.12.0")).toBe(0)
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0)
    expect(isExactVersion("0.12.0")).toBe(true)
    expect(isExactVersion("^0.12.0")).toBe(false)
  })
})
