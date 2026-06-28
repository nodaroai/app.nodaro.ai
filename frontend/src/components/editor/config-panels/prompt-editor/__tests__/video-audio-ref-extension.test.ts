import { describe, it, expect } from "vitest"
import { generateText, type JSONContent } from "@tiptap/core"
import { Document } from "@tiptap/extension-document"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Text } from "@tiptap/extension-text"
import {
  VideoRefExtension,
  AudioRefExtension,
  serializeRefToken,
  parseRefToken,
} from "../video-audio-ref-extension"

/**
 * Round-trip contract tests for the `{video:N:label}` / `{audio:N:label}`
 * atomic inline nodes (Task 5.1). These mirror the load-bearing invariant of
 * the `{image:N:label}` extension: the atomic pill is a PURE DISPLAY layer, so
 *
 *   serialize(node)  →  the exact literal token string  →  parse  →  the node attrs
 *
 * must be lossless, with the SAME grammar the image extension uses (digit
 * index + optional `[a-zA-Z0-9_-]` label). Two assertion surfaces:
 *
 *   - `generateText` over a ProseMirror doc containing the atomic node, which
 *     exercises the node's real `renderText` (what `editor.getText()` emits and
 *     what is persisted to `node.data.prompt`).
 *   - `parseRefToken` — the single-source-of-truth token parser the extension's
 *     input/paste rules delegate to (and which the editor's value→doc scanner
 *     reuses), so the pill ↔ raw-text round trip can never drift.
 */

const EXTENSIONS = [Document, Paragraph, Text, VideoRefExtension, AudioRefExtension]

/** Serialize a single atomic ref node to plain text via its real renderText. */
function serializeNode(type: "videoRef" | "audioRef", refIndex: number, label: string): string {
  const doc: JSONContent = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type, attrs: { refIndex, label } }] }],
  }
  return generateText(doc, EXTENSIONS, { blockSeparator: "\n" })
}

describe("video/audio ref atomic nodes — serialize (renderText)", () => {
  it("serializes a {video:1:clip} node to the literal token", () => {
    expect(serializeNode("videoRef", 1, "clip")).toBe("{video:1:clip}")
  })

  it("serializes a {audio:2:music} node to the literal token", () => {
    expect(serializeNode("audioRef", 2, "music")).toBe("{audio:2:music}")
  })

  it("serializes a label-less {video:3} node (no trailing colon)", () => {
    expect(serializeNode("videoRef", 3, "")).toBe("{video:3}")
  })

  it("serializes a label-less {audio:4} node (no trailing colon)", () => {
    expect(serializeNode("audioRef", 4, "")).toBe("{audio:4}")
  })

  it("keeps surrounding text and multiple nodes byte-exact", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "use " },
            { type: "videoRef", attrs: { refIndex: 1, label: "clip" } },
            { type: "text", text: " over " },
            { type: "audioRef", attrs: { refIndex: 2, label: "music" } },
          ],
        },
      ],
    }
    expect(generateText(doc, EXTENSIONS, { blockSeparator: "\n" })).toBe(
      "use {video:1:clip} over {audio:2:music}",
    )
  })
})

describe("parseRefToken — parse literal token → attrs", () => {
  it("parses {video:1:clip}", () => {
    expect(parseRefToken("{video:1:clip}")).toEqual({ kind: "video", index: 1, label: "clip" })
  })

  it("parses {audio:2:music}", () => {
    expect(parseRefToken("{audio:2:music}")).toEqual({ kind: "audio", index: 2, label: "music" })
  })

  it("parses a label-less {video:3}", () => {
    expect(parseRefToken("{video:3}")).toEqual({ kind: "video", index: 3, label: "" })
  })

  it("parses a label-less {audio:4}", () => {
    expect(parseRefToken("{audio:4}")).toEqual({ kind: "audio", index: 4, label: "" })
  })

  it("accepts underscore/hyphen labels (image-parallel grammar)", () => {
    expect(parseRefToken("{video:1:hero_shot-2}")).toEqual({
      kind: "video",
      index: 1,
      label: "hero_shot-2",
    })
  })

  it("rejects the {image:N} family (handled by the image extension, not this one)", () => {
    expect(parseRefToken("{image:1}")).toBeNull()
    expect(parseRefToken("{image:2:object}")).toBeNull()
  })

  it("rejects a zero index", () => {
    expect(parseRefToken("{video:0}")).toBeNull()
  })

  it("rejects malformed / non-token text", () => {
    expect(parseRefToken("video:1")).toBeNull()
    expect(parseRefToken("{video:}")).toBeNull()
    expect(parseRefToken("just words")).toBeNull()
    expect(parseRefToken("{video:1:bad label}")).toBeNull() // space not allowed (mirrors image)
  })
})

describe("serializeRefToken — pure serializer", () => {
  it("emits the labelled form", () => {
    expect(serializeRefToken("video", 1, "clip")).toBe("{video:1:clip}")
    expect(serializeRefToken("audio", 2, "music")).toBe("{audio:2:music}")
  })

  it("emits the label-less form when label is empty", () => {
    expect(serializeRefToken("video", 3, "")).toBe("{video:3}")
    expect(serializeRefToken("audio", 4, "")).toBe("{audio:4}")
  })
})

describe("serialize ↔ parse round-trip is lossless", () => {
  for (const token of ["{video:1:clip}", "{audio:2:music}", "{video:3}", "{audio:5:my-track}"]) {
    it(`round-trips ${token}`, () => {
      const parsed = parseRefToken(token)
      expect(parsed).not.toBeNull()
      // parse → serialize returns the exact original literal.
      expect(serializeRefToken(parsed!.kind, parsed!.index, parsed!.label)).toBe(token)
      // …and the node's renderText (the editor's getText()) emits the same.
      const nodeType = parsed!.kind === "video" ? "videoRef" : "audioRef"
      expect(serializeNode(nodeType, parsed!.index, parsed!.label)).toBe(token)
    })
  }
})
