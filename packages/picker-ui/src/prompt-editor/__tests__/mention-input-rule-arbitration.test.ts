import { describe, it, expect, vi, afterEach } from "vitest"

/**
 * END-TO-END arbitration tests for the three `@<slug>:N` input rules.
 *
 * The character, location and image-mention grammars all match the same typed
 * surface and separate themselves by returning `false` from `getAttributes` for
 * a slug that isn't theirs. Every other suite in this directory unit-tests the
 * DECISION functions (`resolvePromotableAttrs` and friends) in isolation, which
 * cannot see the two things that actually decide the outcome:
 *
 *   1. TipTap runs input rules in REVERSE registration order
 *      (`ExtensionManager.plugins` does `[...extensions].reverse()`), and the
 *      first rule whose handler produces steps STOPS the loop — so the LAST
 *      registered grammar (`imageMention`) arbitrates every typed token first.
 *   2. The raw `nodeInputRule` coerces a `false` from `getAttributes` to `{}`
 *      (`callOrReturn(...) || {}`) and builds a DEFAULT-attr node anyway, so a
 *      declining rule used to both corrupt the token (`@old-library:1` →
 *      `@:1`) and shadow the grammar that owned it. `gatedNodeInputRule` is
 *      what makes declining real.
 *
 * So these tests drive the real rules through a real editor: type the token,
 * then feed the trailing space through the input-rule plugin exactly as
 * ProseMirror does, and assert on the resulting doc.
 */
const fmt = vi.hoisted(() => ({ value: "hybrid" as "legacy" | "hybrid" }))

vi.mock("../lib/image-reference-format", () => ({
  get IMAGE_REFERENCE_FORMAT() {
    return fmt.value
  },
}))

// The pills are React node views; this suite only cares about the DOC, so the
// renderer is stubbed to a bare ProseMirror node view (mirrors the stub the
// `*-ref-view` suites use for the same reason).
vi.mock("@tiptap/react", () => ({
  ReactNodeViewRenderer: () => () => ({ dom: document.createElement("span") }),
  NodeViewWrapper: () => null,
}))

// eslint-disable-next-line import/first
import { Editor } from "@tiptap/core"
// eslint-disable-next-line import/first
import { Document } from "@tiptap/extension-document"
// eslint-disable-next-line import/first
import { Paragraph } from "@tiptap/extension-paragraph"
// eslint-disable-next-line import/first
import { Text } from "@tiptap/extension-text"
// eslint-disable-next-line import/first
import { CharacterRefExtension } from "../character-ref-extension"
// eslint-disable-next-line import/first
import { LocationRefExtension } from "../location-ref-extension"
// eslint-disable-next-line import/first
import { ImageMentionExtension } from "../image-mention-extension"
// eslint-disable-next-line import/first
import type { RefImageItem } from "../editor-types"

/** A wired media ref named `label` — mentionable by `@<slug>:N` in hybrid. */
function media(label: string, index: number): RefImageItem {
  return {
    url: `https://cdn.test/${index}.png`,
    label,
    source: "wired",
    index,
    defaultLabel: "image",
  }
}

function character(slug: string, index: number): RefImageItem {
  return {
    url: `https://cdn.test/c-${slug}.png`,
    label: slug,
    source: "character",
    index,
    defaultLabel: "person",
    characterSlug: slug,
  }
}

function location(slug: string, index: number): RefImageItem {
  return {
    url: `https://cdn.test/l-${slug}.png`,
    label: slug,
    source: "location",
    index,
    defaultLabel: "place",
    locationSlug: slug,
  }
}

const editors: Editor[] = []

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
  fmt.value = "hybrid"
})

/**
 * A real editor with the three mention extensions in `prompt-editor/index.tsx`'s
 * REGISTRATION ORDER (character, location, image) — load-bearing, since the
 * arbitration under test is a function of that order.
 */
function makeEditor(refs: readonly RefImageItem[]): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      Document,
      Paragraph,
      Text,
      CharacterRefExtension,
      LocationRefExtension,
      ImageMentionExtension,
    ],
    content: "",
  })
  editors.push(editor)
  const storage = editor.storage as unknown as Record<
    string,
    { referenceImages?: readonly RefImageItem[]; revision?: number }
  >
  for (const name of ["characterRef", "locationRef", "imageMention"]) {
    storage[name] = storage[name] ?? {}
    storage[name].referenceImages = refs
    storage[name].revision = 1
  }
  return editor
}

/**
 * Type `token` then a trailing space, driving the space through the input-rule
 * plugins the way ProseMirror's `handleTextInput` does. When no rule claims it,
 * the space is inserted as ordinary text so the resulting doc matches what the
 * user would actually see.
 */
function typeToken(editor: Editor, token: string): void {
  editor.commands.insertContent(token)
  const { view } = editor
  const pos = view.state.selection.from
  const handled = view.someProp("handleTextInput", (f) =>
    f(view, pos, pos, " ", () => view.state.tr.insertText(" ", pos, pos)),
  )
  if (!handled) editor.commands.insertContent(" ")
}

/** The pill node types in the doc, in order. */
function pillTypes(editor: Editor): string[] {
  const out: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.isText) return
    if (node.type.name !== "doc" && node.type.name !== "paragraph") out.push(node.type.name)
  })
  return out
}

const text = (editor: Editor) => editor.getText({ blockSeparator: "\n" })

describe("typed @<slug>:N arbitration across the three mention grammars", () => {
  it("promotes a known LOCATION slug to a locationRef, not an empty imageMention", () => {
    const editor = makeEditor([location("old-library", 1), media("Town Square", 2)])
    typeToken(editor, "@old-library:1")
    expect(pillTypes(editor)).toEqual(["locationRef"])
    expect(text(editor)).toContain("@old-library:1")
    expect(text(editor)).not.toContain("@:1")
  })

  it("promotes a known CHARACTER slug to a characterRef", () => {
    const editor = makeEditor([character("kira", 1), location("old-library", 2)])
    typeToken(editor, "@kira:1")
    expect(pillTypes(editor)).toEqual(["characterRef"])
    expect(text(editor)).toContain("@kira:1")
  })

  it("promotes a known IMAGE name-slug to an imageMention", () => {
    const editor = makeEditor([media("Town Square", 1), character("kira", 2)])
    typeToken(editor, "@town-square:1")
    expect(pillTypes(editor)).toEqual(["imageMention"])
    expect(text(editor)).toContain("@town-square:1")
  })

  it("leaves a slug no grammar knows as literal text", () => {
    const editor = makeEditor([character("kira", 1)])
    typeToken(editor, "@nobody:1")
    expect(pillTypes(editor)).toEqual([])
    expect(text(editor)).toContain("@nobody:1")
  })

  it("gives a slug contested between a character and a media name to the CHARACTER", () => {
    // The prompt-builder resolves character → location → image, so the editor
    // must too — even though the image rule arbitrates first.
    const editor = makeEditor([character("kira", 1), media("Kira", 2)])
    typeToken(editor, "@kira:1")
    expect(pillTypes(editor)).toEqual(["characterRef"])
    expect(text(editor)).toContain("@kira:1")
  })

  it("LEGACY: image mentions never promote, and location mentions still do", () => {
    fmt.value = "legacy"
    const editor = makeEditor([location("old-library", 1), media("Town Square", 2)])
    typeToken(editor, "@town-square:2")
    expect(pillTypes(editor)).toEqual([])
    expect(text(editor)).toContain("@town-square:2")

    typeToken(editor, "@old-library:1")
    expect(pillTypes(editor)).toEqual(["locationRef"])
    expect(text(editor)).toContain("@old-library:1")
  })
})
