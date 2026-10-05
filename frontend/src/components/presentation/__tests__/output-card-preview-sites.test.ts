/**
 * Every app output card that can show a render passes its Preview label
 * (`preview={…}`, render-preview.ts) — the Run tab, the presentation, the
 * mobile shell and the chat view (A1b, F1). The two cards of the Preview NODE
 * (`node.type === "preview"`, a collector of upstream items) are the only ones
 * exempt. A new `<OutputCard` site fails here until it says.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..", "..")
const SITES: Record<string, { cards: number; exempt: number }> = {
  "components/presentation/presentation-view.tsx": { cards: 5, exempt: 2 },
  "components/app-runner/mobile-app-shell.tsx": { cards: 3, exempt: 0 },
  "components/presentation/views/chat-view.tsx": { cards: 2, exempt: 0 },
}

/** Each `<OutputCard … />` element's own text. */
function cards(text: string): string[] {
  const out: string[] = []
  let at = text.indexOf("<OutputCard")
  while (at >= 0) {
    const end = text.indexOf("/>", at)
    out.push(text.slice(at, end))
    at = text.indexOf("<OutputCard", end)
  }
  return out
}

describe("app output cards label a Preview", () => {
  for (const [where, { cards: n, exempt }] of Object.entries(SITES)) {
    it(where, () => {
      const found = cards(readFileSync(join(SRC, where), "utf8"))
      expect(found).toHaveLength(n)
      expect(found.filter((c) => !/\bpreview=\{/.test(c))).toHaveLength(exempt)
    })
  }
})
