/**
 * Public Docs Maintenance Rule: the Video Overlay pages describe the slot
 * model the code runs. A layer's number is its slot, and a slot is NOT bounded
 * by the 20-layer limit — removing Layers 1–4 of a 24-layer node leaves
 * Layers 5–24, and both engines run them (videoOverlaySlotSources, the REST
 * route's `slot`). Only the handles stop at 12. This reads the public pages and
 * fails if they bound the handle-less layers at 20 again.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { VIDEO_OVERLAY_HANDLE_IDS, VIDEO_OVERLAY_MAX_LAYERS } from "../video-overlay"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..")
const read = (p: string) => readFileSync(join(ROOT, p), "utf8")
const NODE_PAGE = read("docs/nodes/processing-video/video-overlay.md")
const INVENTORY_ROW = read("docs/node-inventory.md")
  .split("\n")
  .find((l) => l.startsWith("| `video-overlay` |")) ?? ""

const FIRST_HANDLE_LESS = VIDEO_OVERLAY_HANDLE_IDS.length + 1
const SLOT_RANGE = new RegExp(`layers ${FIRST_HANDLE_LESS}\\s*[–-]\\s*${VIDEO_OVERLAY_MAX_LAYERS}`, "i")

describe("Video Overlay public docs — slot model", () => {
  it("the inventory row exists", () => {
    expect(INVENTORY_ROW).not.toBe("")
  })

  it(`never bounds the handle-less layers at ${VIDEO_OVERLAY_MAX_LAYERS}`, () => {
    expect(NODE_PAGE).not.toMatch(SLOT_RANGE)
    expect(INVENTORY_ROW).not.toMatch(SLOT_RANGE)
  })

  it(`says the handle-less layers start at ${FIRST_HANDLE_LESS} and go up`, () => {
    expect(NODE_PAGE).toContain(`layers ${FIRST_HANDLE_LESS} and up`)
    expect(INVENTORY_ROW).toContain(`layers ${FIRST_HANDLE_LESS} and up`)
  })
})
