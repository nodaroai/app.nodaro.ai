// STORAGE_DELETES: whether this deployment deletes objects from storage at all.
//
// `on` (the default) deletes as every install always has. `skip` is for a
// deployment that shares its media storage with another deployment but runs
// on its own copy of the database (for example a staging environment restored
// from production): its rows name files the other deployment still
// references, so nothing here may delete them. The parse is strict: a value
// that is neither refuses to boot, because a typo must not silently delete.
import { describe, it, expect } from "vitest"
import { config, envSchema } from "../config.js"
import { storageDeletesSkipped } from "../storage-deletes-setting.js"

const parse = (value: unknown) => envSchema.shape.STORAGE_DELETES.safeParse(value)

describe("STORAGE_DELETES parsing", () => {
  it("is on when unset: every existing install deletes as before", () => {
    const result = parse(undefined)
    expect(result.success).toBe(true)
    expect(result.data).toBe("on")
  })

  it.each([
    ["", "on"],
    ["   ", "on"],
    ["on", "on"],
    ["ON", "on"],
    ["skip", "skip"],
    [" Skip ", "skip"],
  ])("reads %j as %s (a blank line in an env file is unset)", (raw, want) => {
    const result = parse(raw)
    expect(result.success).toBe(true)
    expect(result.data).toBe(want)
  })

  it.each(["off", "skp", "true", "false", "0", "1", "no"])("refuses %j: the boot fails rather than guess a side", (raw) => {
    expect(parse(raw).success).toBe(false)
  })

  it("a typo stops the whole configuration, as any invalid variable does", () => {
    expect(envSchema.safeParse({ ...process.env, STORAGE_DELETES: "skp" }).success).toBe(false)
    expect(envSchema.safeParse({ ...process.env, STORAGE_DELETES: "skip" }).success).toBe(true)
  })
})

describe("storageDeletesSkipped() — the one place the setting is read", () => {
  it("is false in a process that never set it", () => {
    expect(config.STORAGE_DELETES).toBe("on")
    expect(storageDeletesSkipped()).toBe(false)
  })

  it("reads the parsed config at call time, so a change is seen by the next delete", () => {
    const before = config.STORAGE_DELETES
    try {
      config.STORAGE_DELETES = "skip"
      expect(storageDeletesSkipped()).toBe(true)
      config.STORAGE_DELETES = "on"
      expect(storageDeletesSkipped()).toBe(false)
    } finally {
      config.STORAGE_DELETES = before
    }
  })
})
