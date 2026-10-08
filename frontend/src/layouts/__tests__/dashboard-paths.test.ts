import { describe, expect, it } from "vitest"
import { isEditorPath, loginPathFor } from "../dashboard-paths"

describe("isEditorPath", () => {
  it("is the editor's full address and its short link", () => {
    expect(isEditorPath("/projects/p1/workflows/w1")).toBe(true)
    expect(isEditorPath("/editor/w1")).toBe(true)
  })

  it("is not any other page", () => {
    expect(isEditorPath("/projects/p1")).toBe(false)
    expect(isEditorPath("/shared")).toBe(false)
    expect(isEditorPath("/admin/users")).toBe(false)
  })
})

describe("loginPathFor", () => {
  it("a link opened signed out comes back after sign-in", () => {
    expect(loginPathFor("/editor/w1", false)).toBe("/login?redirect=%2Feditor%2Fw1")
    expect(loginPathFor("/admin/users?user=u1", false)).toBe("/login?redirect=%2Fadmin%2Fusers%3Fuser%3Du1")
  })

  it("a session that ends mid-use starts the next sign-in fresh — it may be someone else's", () => {
    expect(loginPathFor("/projects/p1/workflows/w1", true)).toBe("/login")
  })
})
