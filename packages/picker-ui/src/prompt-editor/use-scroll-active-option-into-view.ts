"use client"

import { useEffect, useRef, type RefObject } from "react"

/**
 * Keeps the active suggestion row visible as keyboard navigation moves the
 * selection. The suggestion popups render each row with a `data-index`
 * attribute and update `selectedIndex` on ArrowUp/Down WITHOUT scrolling, so a
 * selection can drift out of the dropdown's `overflow-y-auto` viewport.
 *
 * Attach the returned ref to the scroll container; on every `selectedIndex`
 * change the matching row is scrolled the minimal amount needed to stay in view
 * (`block: "nearest"` never moves it if it's already visible).
 */
export function useScrollActiveOptionIntoView<T extends HTMLElement = HTMLDivElement>(
  selectedIndex: number,
): RefObject<T | null> {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])
  return ref
}
