// @test-watches tools/build-runtime-config.mjs
import { describe, it, expect, afterEach, vi } from "vitest"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { audioEditorOffered, audioEditorState, runtimeAudiomassUrl } from "../runtime-config"

/**
 * The audio editor's setting from the operator's env to the browser, end to
 * end: `AUDIOMASS_URL` as start.sh hands it to the /config.js writer
 * (`RUNTIME_AUDIOMASS_URL="$AUDIOMASS_URL"`, held in
 * tools/__tests__/build-runtime-config.test.mjs), the exact file the writer
 * prints, that file run in this page, then what the app reads from it: the
 * editor's URL and the state (`audioEditorState`) that decides whether Edit is
 * offered at all.
 *
 * The baked `VITE_AUDIOMASS_URL` (a build arg, Dockerfile) is the fallback
 * when /config.js carries no value.
 */

const WRITER = path.resolve(__dirname, "..", "..", "..", "..", "tools", "build-runtime-config.mjs")
const EDITOR = "https://audiomass.example.internal"

/** The /config.js an install serves with this AUDIOMASS_URL (undefined: not set at all). */
function configJs(audiomassUrl: string | undefined): string {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" }
  // start.sh passes "$AUDIOMASS_URL": an unset variable arrives as "".
  env.RUNTIME_AUDIOMASS_URL = audiomassUrl ?? ""
  const res = spawnSync(process.execPath, [WRITER, "--index-html", "/nonexistent/index.html"], { encoding: "utf8", env })
  expect(res.status, res.stderr).toBe(0)
  return res.stdout
}

/** Runs the file in this page, as index.html's classic script does before the app. */
function serve(audiomassUrl: string | undefined): string {
  const file = configJs(audiomassUrl)
  delete window.__NODARO_RUNTIME__
  new Function(file)()
  return file
}

afterEach(() => {
  delete window.__NODARO_RUNTIME__
  vi.unstubAllEnvs()
})

describe("AUDIOMASS_URL, from the operator's env to the page", () => {
  it("nothing set: /config.js has no audio editor key, and the page reads no editor, with Edit still offered", () => {
    for (const unset of [undefined, "", "  "]) {
      expect(serve(unset)).not.toContain("audiomassUrl")
      expect(window.__NODARO_RUNTIME__).toEqual({})
      expect(runtimeAudiomassUrl(), String(unset)).toBe("")
      expect(audioEditorState(), String(unset)).toBe("unset")
      expect(audioEditorOffered(), String(unset)).toBe(true)
    }
  })

  it.each(["off", "OFF", " none ", "false", "Disabled"])("%j: /config.js carries the word, and the page reads the editor switched off", (value) => {
    serve(value)
    expect(window.__NODARO_RUNTIME__).toEqual({ audiomassUrl: value.trim() })
    expect(runtimeAudiomassUrl()).toBe("")
    expect(audioEditorState()).toBe("off")
    expect(audioEditorOffered()).toBe(false)
  })

  it("an editor: /config.js carries its URL, and the page frames it", () => {
    serve(EDITOR)
    expect(window.__NODARO_RUNTIME__).toEqual({ audiomassUrl: EDITOR })
    expect(runtimeAudiomassUrl()).toBe(EDITOR)
    expect(audioEditorState()).toBe("configured")
    expect(audioEditorOffered()).toBe(true)
  })

  it.each(["/editor", "::::not a url", "audiomass.example.internal"])("%j (not a usable URL) reads as nothing set: no editor, Edit still offered", (value) => {
    serve(value)
    expect(runtimeAudiomassUrl()).toBe("")
    expect(audioEditorState()).toBe("unset")
  })
})

describe("the baked VITE_AUDIOMASS_URL, when /config.js carries none", () => {
  it.each([
    ["an editor", EDITOR, EDITOR, "configured"],
    ["off", "off", "", "off"],
    ["empty", "", "", "unset"],
  ])("baked %s", (_label, baked, url, state) => {
    vi.stubEnv("VITE_AUDIOMASS_URL", baked)
    serve(undefined)
    expect(runtimeAudiomassUrl()).toBe(url)
    expect(audioEditorState()).toBe(state)
  })

  it("a value in /config.js wins over the baked one, either way", () => {
    vi.stubEnv("VITE_AUDIOMASS_URL", EDITOR)
    serve("off")
    expect(runtimeAudiomassUrl()).toBe("")
    expect(audioEditorState()).toBe("off")
    vi.stubEnv("VITE_AUDIOMASS_URL", "off")
    serve(EDITOR)
    expect(runtimeAudiomassUrl()).toBe(EDITOR)
    expect(audioEditorState()).toBe("configured")
  })
})
