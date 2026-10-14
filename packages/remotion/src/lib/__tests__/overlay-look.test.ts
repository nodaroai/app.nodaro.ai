import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ALL_CAPTION_STYLES } from "@nodaro/shared/captions"

// One overlay file per caption style (subtitle + the five kinetic styles). The
// count is pinned to ALL_CAPTION_STYLES below, so adding a caption style without
// adding its overlay here fails the build — which then forces the "consumes the
// look" assertions on the new overlay. This is the guard against the recurring
// "a lever arrives and is silently dropped" bug: every overlay MUST route its
// vertical position through captionAnchor/captionAnchorStyle and its
// font/outline/casing through captionLookStyle.
const CAPTION_OVERLAY_FILES = [
  "subtitle-overlay",
  "word-highlight-overlay",
  "karaoke-overlay",
  "tiktok-pages-overlay",
  "word-pop-overlay",
  "bouncy-overlay",
]

describe("every caption overlay consumes the shared look", () => {
  it("has exactly one overlay per caption style (a new style forces a new overlay here)", () => {
    expect(CAPTION_OVERLAY_FILES.length).toBe(ALL_CAPTION_STYLES.length)
  })

  it.each(CAPTION_OVERLAY_FILES)("%s.tsx routes vertical position through captionAnchor", (name) => {
    const src = readFileSync(join(__dirname, "..", `${name}.tsx`), "utf8")
    // Edge-anchored overlays call captionAnchorStyle(position, positionY) (subtitle,
    // word-highlight, karaoke, bouncy) or captionAnchor(position, positionY) directly
    // (word-pop, tiktok-pages, which build their own transform around the anchor).
    expect(src).toMatch(/captionAnchor(Style)?\(position/)
  })

  it.each(CAPTION_OVERLAY_FILES)("%s.tsx applies captionLookStyle (font / outline / casing)", (name) => {
    const src = readFileSync(join(__dirname, "..", `${name}.tsx`), "utf8")
    expect(src).toContain("captionLookStyle(")
  })

  it.each(CAPTION_OVERLAY_FILES)("%s.tsx never reaches into the edge insets directly (positionY must win via captionAnchor)", (name) => {
    const src = readFileSync(join(__dirname, "..", `${name}.tsx`), "utf8")
    // The retired POSITION_Y map and the current CAPTION_EDGE_INSET map both live
    // behind captionAnchor — an overlay indexing either by hand bypasses the
    // positionY override that captionAnchor applies (the original dropped-lever bug).
    expect(src).not.toContain("POSITION_Y[position]")
    expect(src).not.toContain("CAPTION_EDGE_INSET[")
  })
})

// karaoke + word-highlight are the "row with a spoken cursor" styles: the spoken
// and rest colours must derive from the plan via captionRowColors, never a
// hardcoded grey (which ignored the caller's `color` and rendered the outline
// look wrong). karaoke additionally must NOT reintroduce the background-clip
// gradient fill, whose transparency let the outline stroke bleed over the glyph.
const ROW_CURSOR_OVERLAYS = ["karaoke-overlay", "word-highlight-overlay"]
describe("row-cursor overlays derive colours from the plan", () => {
  it.each(ROW_CURSOR_OVERLAYS)("%s.tsx uses captionRowColors and hardcodes no colour", (name) => {
    const src = readFileSync(join(__dirname, "..", `${name}.tsx`), "utf8")
    expect(src).toContain("captionRowColors(")
    // Every colour comes from the plan (`color`/`highlightColor`) — no hex literal.
    expect(src).not.toMatch(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/)
  })
  it("karaoke-overlay.tsx no longer uses a background-clip gradient fill (stroke-over-transparent bug)", () => {
    const src = readFileSync(join(__dirname, "..", "karaoke-overlay.tsx"), "utf8")
    expect(src).not.toContain("backgroundClip")
    expect(src).not.toContain("WebkitTextFillColor")
  })
})

// Overlays that render a ROW of separate word <span>s must space the words
// through captionWord — word-level captions[] arrive as bare words with no
// delimiter, so rendering `{c.text}` directly glues them ("facedoesn'tdrift.").
// (subtitle renders one full line; word-pop renders a single word — neither
// builds a multi-word row, so neither needs it.)
const WORD_ROW_OVERLAYS = ["word-highlight-overlay", "karaoke-overlay", "bouncy-overlay", "tiktok-pages-overlay"]

describe("word-row overlays space words through captionWord", () => {
  it.each(WORD_ROW_OVERLAYS)("%s.tsx uses captionWord for per-word text", (name) => {
    const src = readFileSync(join(__dirname, "..", `${name}.tsx`), "utf8")
    expect(src).toContain("captionWord(")
  })
  it.each(WORD_ROW_OVERLAYS)("%s.tsx does not render a bare {c.text}/{t.text} word (glue regression)", (name) => {
    const src = readFileSync(join(__dirname, "..", `${name}.tsx`), "utf8")
    expect(src).not.toMatch(/\{\s*[ct]\.text\s*\}/)
  })
})
