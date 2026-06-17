import { createRoot, type Root } from "react-dom/client"
import { computeFlipPosition } from "./flip-position"
import { escapeScrollLock } from "./scroll-lock-escape"
import { PROMPT_EDITOR_PORTAL_ATTR } from "./prompt-editor-portal"

export interface SuggestionKeyHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

/**
 * Shared floating-mount scaffolding for the editor's suggestion popups
 * (`@` refs, `{` variables, `/` snippets). Owns the body-mounted fixed div,
 * the flip-above-when-cramped positioning, the createRoot lifecycle, and the
 * deferred unmount (setTimeout dodges React's unmount-during-render warning).
 * Per-trigger content renders via `renderInto`, which must wire the list's
 * imperative key handle through `setKeyHandle` for ArrowUp/Down/Enter/Tab.
 *
 * Extracted from three byte-identical `render()` closures in `index.tsx`
 * (the only real divergence was which List renders, the handle type, and the
 * `@` site's extra `clearFilter` — all now expressed via `renderInto`). The
 * positioning matches the original `positionMount`: 160px flip threshold,
 * 300px estimated height, `left` clamped into the viewport.
 */
export function createFloatingSuggestionRenderer<P extends { clientRect?: (() => DOMRect | null) | null }>(
  estimatedWidth: number,
  renderInto: (root: Root, props: P, setKeyHandle: (h: SuggestionKeyHandle | null) => void) => void,
) {
  return () => {
    let mount: HTMLDivElement | null = null
    let root: Root | null = null
    let keyHandle: SuggestionKeyHandle | null = null
    let detachScrollLock: (() => void) | null = null
    const setKeyHandle = (h: SuggestionKeyHandle | null) => { keyHandle = h }

    const position = (rect: DOMRect | null | undefined) => {
      if (!mount || !rect) return
      // Mirrors the original positionMount: ESTIMATED_H tracks the list's
      // 300px max-h clamp; the 160px flip threshold + secondary `>= rect.top`
      // clause are the suggestion-list defaults (secondaryClauseMargin 0).
      const { top, left } = computeFlipPosition(rect, { width: estimatedWidth, estHeight: 300 })
      mount.style.top = `${top}px`
      mount.style.left = `${left}px`
    }

    const render = (props: P) => {
      if (!root) return
      position(props.clientRect?.() ?? null)
      renderInto(root, props, setKeyHandle)
    }

    return {
      onStart: (props: P) => {
        mount = document.createElement("div")
        mount.style.position = "fixed"
        mount.style.zIndex = "9999"
        // body has pointer-events:none inside a modal Dialog
        mount.style.pointerEvents = "auto"
        // Mark as a prompt-editor portal so a host Dialog's outside-interaction
        // dismissal ignores clicks here — selecting an item must not close it.
        mount.setAttribute(PROMPT_EDITOR_PORTAL_ATTR, "")
        document.body.appendChild(mount)
        // …and the dialog's react-remove-scroll blocks wheel/touch for body-
        // mounted nodes — stop those events here so the popup can scroll.
        detachScrollLock = escapeScrollLock(mount)
        root = createRoot(mount)
        render(props)
      },
      onUpdate: (props: P) => render(props),
      onKeyDown: (props: { event: KeyboardEvent }) => keyHandle?.onKeyDown(props.event) ?? false,
      onExit: () => {
        detachScrollLock?.()
        detachScrollLock = null
        if (root) {
          const r = root
          root = null
          setTimeout(() => r.unmount(), 0)
        }
        if (mount) {
          const m = mount
          mount = null
          setTimeout(() => m.remove(), 0)
        }
        keyHandle = null
      },
    }
  }
}
