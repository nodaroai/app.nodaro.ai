import { useEffect, type RefObject } from "react"
import { useInertBehind } from "@/lib/use-inert-behind"

/**
 * What the Filerobot photo editor leaves out for keyboard and screen-reader
 * users (WCAG 2.1.1, 4.1.2), added from outside as it draws and redraws
 * itself. Ported from tools.nodaro.ai's photo editor (same library version):
 * - its tabs and tool choices are plain divs marked `aria-selected`: each
 *   becomes a focusable tab (in a tablist) that Enter or Space picks;
 * - a few controls have no name (an icon only, a bare number field), and a
 *   fine-tune's slider and number field have none either: each is named by
 *   its setting ("Brightness", "Hue" …, as the editor itself labels them);
 * - while the editor is open, the page behind it is `inert`, so focus and
 *   reading stay inside it (Filerobot's own pickers open later, outside).
 * Crop's tab holds its presets button: a tab wrapping a control, which the
 * accessibility statement lists. Re-check the test ids and class names when
 * react-filerobot-image-editor is upgraded.
 */

export interface FilerobotWords {
  readonly toolsMenu: string
  readonly cropPresets: string
  readonly textSize: string
}

const UNNAMED: readonly (readonly [string, keyof FilerobotWords])[] = [
  ["FIE-topbar-menu-button", "toolsMenu"],
  ["FIE-crop-presets-opener-button", "cropPresets"],
  ["FIE-text-size-option", "textSize"],
]

/** Filerobot's choices drawn as divs: its tabs and each tab's tools. */
const CHOICE = "div[aria-selected]"

/** Marks a list this file made a tablist, so it can take that back when Filerobot reuses the list. */
const MENDED = "data-fie-tablist"

/** Where Filerobot draws outside the editor's own layer: its tabs drawer on a phone. */
const DRAWER = ".SfxDrawer-temporary"

/** A fine-tune's slider sits in `FIE-<setting>-option`, its number field is `FIE-<setting>-option-input`. */
const SETTING = /^FIE-(.+)-option$/

/** The setting's word as the (English) editor shows it: `brightness` → "Brightness", `hueRotate` → "Hue rotate". */
export function settingWord(setting: string): string {
  const words = setting.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function mend(root: HTMLElement, words: FilerobotWords) {
  for (const [id, key] of UNNAMED) {
    for (const el of root.querySelectorAll(`[data-testid="${id}"]:not([aria-label])`)) el.setAttribute("aria-label", words[key])
  }
  for (const slider of root.querySelectorAll<HTMLElement>('[data-testid$="-option"]')) {
    const setting = SETTING.exec(slider.dataset.testid ?? "")?.[1]
    if (!setting || setting === "text-size") continue
    const word = settingWord(setting)
    for (const el of slider.querySelectorAll('input[type="range"]:not([aria-label])')) el.setAttribute("aria-label", word)
    for (const el of root.querySelectorAll(`[data-testid="FIE-${setting}-option-input"]:not([aria-label])`)) el.setAttribute("aria-label", word)
  }
  for (const el of root.querySelectorAll<HTMLElement>(`${CHOICE}:not([role])`)) {
    el.setAttribute("role", "tab")
    el.tabIndex = 0
    // A tab's tools sit one per list item (ul > li > div): the list is the tablist, its items only hold.
    const holder = el.parentElement
    const list = holder?.tagName === "LI" ? holder.parentElement : holder
    list?.setAttribute("role", "tablist")
    list?.setAttribute(MENDED, "")
  }
  for (const list of root.querySelectorAll<HTMLElement>(`[${MENDED}]`)) {
    // Filerobot reuses its elements: a list that held tools may now hold another list (Finetune turned to Filters).
    if (!list.querySelector(':scope > [role="tab"], :scope > li > [role="tab"]')) {
      list.removeAttribute("role")
      list.removeAttribute(MENDED)
      for (const item of list.children) if (item.getAttribute("role") === "presentation") item.removeAttribute("role")
      continue
    }
    // A tablist has tabs, not items: each of its items only holds.
    for (const item of list.children) if (item.tagName === "LI") item.setAttribute("role", "presentation")
  }
}

export function useFilerobotA11y(root: RefObject<HTMLElement | null>, words: FilerobotWords) {
  useEffect(() => {
    const node = root.current
    if (!node) return
    // Watched: the editor's own tree, and each phone drawer it opens under <body>
    // (with its tree). Never the whole app, which keeps changing behind the
    // editor during a run.
    const watched = new WeakSet<Node>()
    // Filerobot redraws often (a slider drag): its changes are mended once per frame, not once each.
    let frame = 0
    const observer = new MutationObserver(() => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        mendNow()
      })
    })
    const watch = (el: HTMLElement) => {
      if (watched.has(el)) return
      watched.add(el)
      observer.observe(el, { childList: true, subtree: true })
    }
    const mendNow = () => {
      mend(node, words)
      for (const drawer of document.querySelectorAll<HTMLElement>(DRAWER)) {
        watch(drawer)
        mend(drawer, words)
      }
    }
    watch(node)
    observer.observe(document.body, { childList: true })
    mendNow()
    const pick = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if ((event.key === "Enter" || event.key === " ") && target?.matches(CHOICE)) {
        event.preventDefault()
        target.click()
      }
    }
    document.addEventListener("keydown", pick)
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener("keydown", pick)
    }
  }, [root, words])

  useInertBehind(root)
}
