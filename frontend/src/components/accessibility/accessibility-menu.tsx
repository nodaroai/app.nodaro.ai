import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import {
  Accessibility,
  AArrowDown,
  AArrowUp,
  Contrast,
  Eclipse,
  Heading,
  Link2,
  MousePointer2,
  Pause,
  RotateCcw,
  SunMoon,
  Type,
  TextWrap,
  X,
} from "lucide-react"
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useT } from "@/lib/i18n"
import type { MessageKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/i18n/format"
import {
  applyPreferences,
  DEFAULT_PREFERENCES,
  hiddenUntilAfter,
  isDefault,
  loadHiddenUntil,
  loadPreferences,
  saveHiddenUntil,
  savePreferences,
  setToggle,
  type HideMonths,
  type AccessibilityPreferences,
  type TextScale,
  type ToggleKey,
} from "@/lib/accessibility-preferences"
import { ACCESSIBILITY_STATEMENT_PATH } from "@/lib/accessibility-statement"

/**
 * The accessibility menu: a round button in the bottom corner (inline END,
 * clear of the sidebar's footer) that opens a panel of display choices, also
 * opened with Alt+A from anywhere. On the editor, embeds and presentations the
 * corners belong to the canvas, so the button is not drawn there and Alt+A
 * opens the panel from the same corner. The viewer may also hide the button
 * for one, three or six months (kept in this browser); Alt+A still works.
 *
 * The panel is a Radix popover: focus moves in and Escape closes it. Focus
 * goes back to where it was before Alt+A (a canvas node, a field), or to the
 * button that opened it. Each choice is a pressed/not-pressed button.
 */

type ToggleRow = { readonly key: ToggleKey; readonly label: MessageKey; readonly icon: ReactNode }

/** One at a time, like the shared header's menu (setToggle turns the other two off). */
const CONTRAST_TOGGLES: ReadonlyArray<ToggleRow> = [
  { key: "contrast", label: "a11yMenu.contrast", icon: <Contrast className="size-4" aria-hidden /> },
  { key: "invert", label: "a11yMenu.invert", icon: <SunMoon className="size-4" aria-hidden /> },
  { key: "strong", label: "a11yMenu.strong", icon: <Eclipse className="size-4" aria-hidden /> },
]

const TOGGLES: ReadonlyArray<ToggleRow> = [
  { key: "links", label: "a11yMenu.links", icon: <Link2 className="size-4" aria-hidden /> },
  { key: "headings", label: "a11yMenu.headings", icon: <Heading className="size-4" aria-hidden /> },
  { key: "readableFont", label: "a11yMenu.font", icon: <Type className="size-4" aria-hidden /> },
  { key: "spacing", label: "a11yMenu.spacing", icon: <TextWrap className="size-4" aria-hidden /> },
  { key: "bigCursor", label: "a11yMenu.cursor", icon: <MousePointer2 className="size-4" aria-hidden /> },
  { key: "stopMotion", label: "a11yMenu.motion", icon: <Pause className="size-4" aria-hidden /> },
]

const TEXT_SCALE_PERCENT: Readonly<Record<TextScale, number>> = { 0: 100, 1: 115, 2: 130 }

const HIDE_LABELS: Readonly<Record<HideMonths, MessageKey>> = {
  1: "a11yMenu.hide1",
  3: "a11yMenu.hide3",
  6: "a11yMenu.hide6",
}

const TYPING_TARGETS =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only'], [role='textbox']"

/**
 * Alt+A, but never while typing (on a Mac, Option+A types a character) and not
 * over a modal window, whose focus trap would keep the keyboard out of the panel.
 */
export function isMenuShortcut(event: KeyboardEvent, root: ParentNode = document): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.code !== "KeyA") return false
  const target = event.target as HTMLElement | null
  if (target?.closest?.(TYPING_TARGETS)) return false
  return root.querySelector("[role='dialog'][aria-modal='true'], [role='alertdialog'][aria-modal='true']") === null
}

/** Paths whose corners belong to a canvas or a full-screen view. */
export function buttonHiddenOn(pathname: string): boolean {
  return /^\/(editor|embed|present)\//.test(pathname) || /^\/projects\/[^/]+\/workflows\//.test(pathname)
}

interface AccessibilityMenuProps {
  readonly pathname: string
  readonly showStatementLink: boolean
  readonly onNavigate: (path: string) => void
}

export function AccessibilityMenu({ pathname, showStatementLink, onNavigate }: AccessibilityMenuProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<AccessibilityPreferences>(loadPreferences)
  const [hiddenUntil, setHiddenUntil] = useState<number | null>(() => loadHiddenUntil())
  const returnFocus = useRef<HTMLElement | null>(null)
  const onCanvasPage = buttonHiddenOn(pathname)
  const showButton = !onCanvasPage && hiddenUntil === null

  useEffect(() => {
    applyPreferences(prefs)
  }, [prefs])

  // The editor's canvas keeps its own text size (globals.css reads this).
  useEffect(() => {
    const root = document.documentElement
    if (onCanvasPage) root.setAttribute("data-a11y-canvas", "")
    else root.removeAttribute("data-a11y-canvas")
  }, [onCanvasPage])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isMenuShortcut(event)) return
      event.preventDefault()
      setOpen((was) => {
        if (!was) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        return !was
      })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const update = useCallback((next: AccessibilityPreferences) => {
    setPrefs(next)
    savePreferences(next)
  }, [])

  const hideFor = (months: HideMonths) => {
    const until = hiddenUntilAfter(months)
    saveHiddenUntil(until)
    setHiddenUntil(until)
    setOpen(false)
  }
  const showAgain = () => {
    saveHiddenUntil(null)
    setHiddenUntil(null)
  }

  const toggle = (key: ToggleKey) => update(setToggle(prefs, key, !prefs[key]))
  const toggleButtons = (rows: ReadonlyArray<ToggleRow>) =>
    rows.map(({ key, label, icon }) => (
      <ToggleButton key={key} pressed={prefs[key]} label={t(label)} icon={icon} onClick={() => toggle(key)} />
    ))
  const scaleBy = (delta: 1 | -1) =>
    update({ ...prefs, textScale: Math.min(2, Math.max(0, prefs.textScale + delta)) as TextScale })

  const openStatement = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    returnFocus.current = null
    setOpen(false)
    onNavigate(ACCESSIBILITY_STATEMENT_PATH)
  }

  // Back to where the keyboard was before Alt+A; Radix's own return (the
  // trigger) when the button opened it or the element is gone.
  const onCloseAutoFocus = (event: Event) => {
    const target = returnFocus.current
    returnFocus.current = null
    if (target?.isConnected && target !== document.body) {
      event.preventDefault()
      target.focus()
    }
  }

  const corner = "fixed bottom-4 end-4 z-40"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {showButton ? (
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={() => {
              returnFocus.current = null
            }}
            aria-label={t("a11yMenu.open")}
            title={t("a11yMenu.open")}
            className={cn(
              corner,
              "flex size-11 items-center justify-center rounded-full bg-[#1d4ed8] text-white shadow-lg",
              "outline-none focus-visible:ring-4 focus-visible:ring-[#1d4ed8]/40 hover:bg-[#1e40af]",
            )}
          >
            <Accessibility className="size-6" aria-hidden />
          </button>
        </PopoverTrigger>
      ) : (
        <PopoverAnchor asChild>
          <span className={cn(corner, "size-px")} aria-hidden />
        </PopoverAnchor>
      )}
      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        onCloseAutoFocus={onCloseAutoFocus}
        aria-label={t("a11yMenu.title")}
        className="w-80 p-0"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{t("a11yMenu.title")}</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("common.close")}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-1 p-2">
          <div className="flex items-center justify-between rounded-md px-2 py-1.5">
            <span className="text-sm">{t("a11yMenu.textSize")}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => scaleBy(-1)}
                disabled={prefs.textScale === 0}
                aria-label={t("a11yMenu.textSmaller")}
                className="rounded-md border p-1.5 hover:bg-accent disabled:opacity-40"
              >
                <AArrowDown className="size-4" aria-hidden />
              </button>
              <output aria-live="polite" className="w-12 text-center text-xs tabular-nums">
                {TEXT_SCALE_PERCENT[prefs.textScale]}%
              </output>
              <button
                type="button"
                onClick={() => scaleBy(1)}
                disabled={prefs.textScale === 2}
                aria-label={t("a11yMenu.textBigger")}
                className="rounded-md border p-1.5 hover:bg-accent disabled:opacity-40"
              >
                <AArrowUp className="size-4" aria-hidden />
              </button>
            </div>
          </div>

          <div role="group" aria-describedby="a11y-contrast-note" className="space-y-1">
            {toggleButtons(CONTRAST_TOGGLES)}
            <span id="a11y-contrast-note" className="sr-only">
              {t("a11yMenu.contrastOne")}
            </span>
          </div>
          {toggleButtons(TOGGLES)}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm">
          <button
            type="button"
            onClick={() => update(DEFAULT_PREFERENCES)}
            disabled={isDefault(prefs)}
            className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline disabled:opacity-40 disabled:no-underline"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {t("a11yMenu.reset")}
          </button>
          {showStatementLink && (
            <a href={ACCESSIBILITY_STATEMENT_PATH} onClick={openStatement} className="underline underline-offset-4">
              {t("legal.accessibility")}
            </a>
          )}
        </div>
        <div className="space-y-2 border-t px-4 py-3 text-sm">
          {hiddenUntil !== null ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {t("a11yMenu.hiddenUntil", { date: formatDate(hiddenUntil, { dateStyle: "medium" }) })}
              </span>
              <button type="button" onClick={showAgain} className="shrink-0 underline underline-offset-4">
                {t("a11yMenu.showAgain")}
              </button>
            </div>
          ) : (
            <div role="group" aria-labelledby="a11y-hide-label" className="flex flex-wrap items-center gap-1.5">
              <span id="a11y-hide-label" className="me-1 text-xs text-muted-foreground">
                {t("a11yMenu.hide")}
              </span>
              {([1, 3, 6] as const).map((months) => (
                <button
                  key={months}
                  type="button"
                  onClick={() => hideFor(months)}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                >
                  {t(HIDE_LABELS[months])}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("a11yMenu.shortcut")}</p>
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface ToggleButtonProps {
  readonly pressed: boolean
  readonly label: string
  readonly icon: ReactNode
  readonly onClick: () => void
}

/** One choice: a pressed/not-pressed button with a switch drawn beside its label. */
function ToggleButton({ pressed, label, icon, onClick }: ToggleButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-2 py-2 text-start text-sm hover:bg-accent",
        pressed && "bg-accent font-medium",
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {/* Its own colours under inverted colours and strong contrast (globals.css), so on and off still differ. */}
      <span
        aria-hidden
        data-a11y-switch=""
        data-a11y-keep-colour=""
        className={cn(
          "h-4 w-7 rounded-full p-0.5 transition-colors",
          pressed ? "bg-[#1d4ed8]" : "bg-muted-foreground/40",
        )}
      >
        <span className={cn("block size-3 rounded-full bg-white", pressed && "ms-3")} />
      </span>
    </button>
  )
}
