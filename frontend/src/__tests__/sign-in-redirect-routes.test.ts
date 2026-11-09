import { describe, it, expect } from "vitest"

/**
 * The live route tree decides where a completed sign-in may open in place
 * (lib/sign-in-redirect.ts). Importing the router registers it; this pins
 * that it does, and what it then says about the paths that matter:
 *
 *   - the app's own pages open in place, exactly as before (Nodaro's sign-in
 *     round trips are unchanged);
 *   - the pages of the other products served beside the app on one host —
 *     the voice changer under /voice-changer, and the tools' worlds at
 *     /image, /video/…, /music, /trends/… — are not the app's, so they get a
 *     full page load instead of the app's not-found page.
 *
 * A top-level route that swallowed one of those paths (a bare `/:slug`, say)
 * would send its sign-ins to the wrong product; this fails first.
 */
import "@/router"
import { isAppPath } from "@/lib/sign-in-redirect"

describe("the router's own pages", () => {
  it("open in place", () => {
    for (const path of [
      "/",
      "/projects",
      "/projects/p1",
      "/projects/p1/workflows/w1",
      "/editor/w1",
      "/library?job=1",
      "/my-files",
      "/settings",
      "/settings/api",
      "/present/share-token",
      "/app/some-app",
      "/oauth/authorize?client_id=x",
      "/auth/cli",
      "/login",
    ]) {
      expect(isAppPath(path), path).toBe(true)
    }
  })
})

describe("another product's pages on the same host", () => {
  it("are not the app's", () => {
    for (const path of [
      "/voice-changer",
      "/voice-changer/",
      "/voice-changer/convert/abc",
      "/he/voice-changer/convert/abc",
      "/pt-br/voice-changer",
      "/image",
      "/video/abc",
      "/music",
      "/trends/some-trend",
    ]) {
      expect(isAppPath(path), path).toBe(false)
    }
  })
})
