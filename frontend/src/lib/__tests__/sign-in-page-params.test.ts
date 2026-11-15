// @test-watches frontend/src/**/*.{ts,tsx}
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { SIGN_IN_PAGE_PARAMS } from "@/lib/sign-in-redirect"

/**
 * A link to the sign-in page may carry only what that page reads. One that
 * names its destination under another spelling still opens the page, and the
 * destination is dropped without a word: the visitor signs in and lands on the
 * projects list instead of the page that sent them (the tutorial page did
 * this with `?next=`).
 */

const SRC = join(__dirname, "..", "..")
const LOGIN_PAGE = "app/(auth)/login/page.tsx"

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" ? [] : sources(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** Every query name a `/login?…` address in the app's own code carries, with the file that writes it. */
function namesSent(): { file: string; name: string }[] {
  const found: { file: string; name: string }[] = []
  for (const path of sources(SRC)) {
    const text = readFileSync(path, "utf8")
    for (const address of text.matchAll(/\/login\?([^\s"'`)]+)/g)) {
      // Query names only: what a `${…}` renders is a value, never a name.
      const query = address[1].replace(/\$\{[^}]*\}/g, "")
      for (const pair of query.split("&")) {
        const name = pair.split("=")[0]
        if (name) found.push({ file: relative(SRC, path), name })
      }
    }
  }
  return found
}

describe("links to the sign-in page", () => {
  it("carry only what the page reads", () => {
    const unread = namesSent().filter(({ name }) => !(SIGN_IN_PAGE_PARAMS as readonly string[]).includes(name))
    expect(unread).toEqual([])
  })

  it("find some to check", () => {
    expect(namesSent().length).toBeGreaterThan(5)
  })

  it("the page reads every name on the list", () => {
    const page = readFileSync(join(SRC, LOGIN_PAGE), "utf8")
    const unreadByPage = SIGN_IN_PAGE_PARAMS.filter((name) => !page.includes(`searchParams.get("${name}")`))
    expect(unreadByPage).toEqual([])
  })
})
