"use client"
import { useAppDir } from "@/lib/locale-store"
import type { LocaleDirection } from "@nodaro/shared"

/**
 * Reading direction for TEXT rendered inside a node card.
 *
 * The React Flow canvas is pinned `direction: ltr` (`.react-flow` in
 * globals.css), so a card's GEOMETRY is the same in every locale: handles keep
 * their sides, corner controls keep their corners, and the header row stays
 * [icon][title][chips]. That is deliberate — the canvas is shared content, not
 * chrome. But the STRINGS inside the card are the user's language, and a
 * Hebrew string laid out in an LTR paragraph reorders its punctuation, breaks
 * mixed Hebrew/Latin runs (model names, resolutions) and hugs the wrong edge.
 *
 * This hook is the one source for that: it returns the app's live direction
 * ({@link useAppDir}), which is what `<html dir>` carries, NOT the picker's
 * pinned `usePickerDir()`.
 *
 * HOW TO APPLY IT — text LEAVES only:
 *
 *   <span dir={textDir}>{title}</span>      // yes: a text node's own element
 *   <input dir={textDir} … />               // yes
 *   <div dir={textDir} className="flex">    // NO
 *
 * `direction` is an INHERITED CSS property and it drives the inline axis, so a
 * `dir` on a layout container flows into every flex/grid row beneath it and
 * mirrors that subtree — while any absolutely-positioned sibling using a
 * physical `left-`/`right-` offset stays put. On the ~150 node cards that mix
 * the two, that reads as a broken card, not a translated one. Put `dir` on the
 * element that actually holds the text; a card that renders its own prose
 * region is responsible for its own leaves.
 *
 * (Tailwind direction VARIANTS are banned repo-wide — see
 * `lib/__tests__/rtl-direction-guards.test.ts`. Read the direction here.)
 */
export function useNodeTextDir(): LocaleDirection {
  return useAppDir()
}
