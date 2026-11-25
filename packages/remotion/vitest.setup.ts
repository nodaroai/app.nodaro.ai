// Testing Library's waits (findBy*, waitFor) get CI's slow-host factor like
// the test limits do (tools/vitest/ci-limits.mjs); locally its 1 s default.
// Only in the files that opt into jsdom: the rest run in node and never load
// Testing Library.
import { testingLibraryOptions } from "../../tools/vitest/ci-limits.mjs"

if (typeof document !== "undefined") {
  const { configure } = await import("@testing-library/dom")
  configure(testingLibraryOptions())
}
