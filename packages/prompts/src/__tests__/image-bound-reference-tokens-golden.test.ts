import { describe, it, expect } from "vitest"
import type { ConnectedReference } from "@nodaro/shared"
import { buildImagePrompt, type BuildImagePromptConfig } from "../prompt-builder.js"

/**
 * WIRED-case golden: every `{image:N}` token below binds to a reference (or
 * the prompt carries no token at all), so the unwired-token rule must leave
 * each output BYTE-IDENTICAL. The snapshot was captured from the assembly as
 * it was before that rule existed; a change to any entry here means a wired
 * output moved.
 *
 * Covers both engines' shapes: the flat path (`referenceImageUrls` only, the
 * orchestrator's images-only branch) and the connected-reference path (the
 * canvas, the route's structured mode), in the legacy and hybrid formats,
 * with and without a wired character, style, negative, reorder, and a
 * provider that takes no reference images.
 */

const hat: ConnectedReference = { id: "up-hat", defaultName: "Hat", source: "wired-image", url: "https://r2/hat.png" }
const coat: ConnectedReference = { id: "up-coat", defaultName: "Coat", source: "wired-image", url: "https://r2/coat.png" }
const face: ConnectedReference = { id: "face-1", defaultName: "Sarah", source: "wired-face", url: "https://r2/sarah.png", description: "tall, red hair" }
const kira: ConnectedReference = {
  id: "char-kira",
  defaultName: "Kira",
  source: "wired-character",
  url: "https://r2/kira.png",
  characterSlug: "kira",
  variantDisplayName: "canonical",
  characterCanonicalDescription: "auburn shoulder-length hair",
}

const PROMPTS: Record<string, string> = {
  creatorAtHome: "Waist-up photo of {image:1:person}, an adult, standing at home in front of a plain wall, arms relaxed, empty hands.",
  productInHand: "An adult woman in her thirties holds {image:1:product} at chest height toward the viewer, label facing out, in a bright room at home.",
  skinDetailSheet: "Create a single skin detail reference sheet titled \"SKIN DETAIL SHEET\" from {image:1:person}, the single source of truth for identity, skin tone and features. Six panels: PANEL 01 — FULL FACE (front, eye level) · PANEL 02 — LEFT CHEEK & NOSE. In every panel: Skin shows its real structure. Plain neutral grey background, thin white panel labels in English.",
  facePrivacy: "remove persons faces from {image:1}, keep everything else the same",
  twoTokens: "{image:1:person} with {image:2:face}",
  pillSpacing: "a man wearing {image:1:hat}  in the park",
  multiLine: "Scene:\n    {image:1:person} stands  still\n\n{image:2} behind",
  tokenFreeSpacing: "a  cat   on a mat ",
  tokenFreeIndented: "Shot list:\n    1. wide\n    2. close  up",
}

type Shape = (prompt: string) => BuildImagePromptConfig

const SHAPES: Record<string, Shape> = {
  "flat path, two refs": (prompt) => ({
    prompt, provider: "nano-banana-pro", referenceImageUrls: [hat.url!, coat.url!],
  }),
  "flat path, two ancestor refs, style + negative": (prompt) => ({
    prompt, provider: "nano-banana-pro", ancestorRefs: [hat.url!, coat.url!], style: "cinematic", negativePrompt: "blurry",
  }),
  "flat path, provider without reference support": (prompt) => ({
    prompt, provider: "ideogram-v3", referenceImageUrls: [hat.url!, coat.url!],
  }),
  "connected refs, legacy": (prompt) => ({
    prompt, provider: "nano-banana-pro", connectedReferences: [hat, coat],
  }),
  "connected refs, legacy, face + image, style + negative": (prompt) => ({
    prompt, provider: "nano-banana-pro", connectedReferences: [face, coat], style: "cinematic", negativePrompt: "blurry",
  }),
  "connected refs, legacy, reorder": (prompt) => ({
    prompt, provider: "nano-banana-pro", connectedReferences: [hat, coat], referenceOrder: ["wired:up-coat", "wired:up-hat"],
  }),
  "connected refs, legacy, wired character first": (prompt) => ({
    prompt, provider: "nano-banana-pro", connectedReferences: [kira, hat, coat],
  }),
  "connected refs, hybrid": (prompt) => ({
    prompt, provider: "nano-banana-pro", connectedReferences: [hat, coat], referenceFormat: "hybrid",
  }),
  "connected refs, hybrid, wired character first": (prompt) => ({
    prompt, provider: "nano-banana-pro", connectedReferences: [kira, hat, coat], referenceFormat: "hybrid",
  }),
  "connected refs, hybrid, bound token in the negative": (prompt) => ({
    prompt, provider: "nano-banana-pro", connectedReferences: [hat, coat], referenceFormat: "hybrid", negativePrompt: "{image:1:hat} on the floor",
  }),
  "connected refs, legacy, provider without reference support": (prompt) => ({
    prompt, provider: "ideogram-v3", connectedReferences: [hat, coat],
  }),
}

describe("image prompt assembly — wired reference tokens are byte-identical", () => {
  for (const [shapeName, shape] of Object.entries(SHAPES)) {
    for (const [promptName, prompt] of Object.entries(PROMPTS)) {
      it(`${shapeName} · ${promptName}`, () => {
        expect(buildImagePrompt(shape(prompt))).toMatchSnapshot()
      })
    }
  }
})
