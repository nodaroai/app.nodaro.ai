import { useEffect, useState, type ReactNode } from "react"
import { useTheme } from "next-themes"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import type { RowScroller } from "./home-ui"

/** A panel section heading: the title on the start side, controls on the end side. */
export function SectionTitle({
  title,
  trailing,
}: {
  readonly title: string
  readonly trailing?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[17px] font-semibold text-[var(--home-strong)]">{title}</h2>
      {trailing}
    </div>
  )
}

export interface SegmentOption<T extends string> {
  readonly value: T
  readonly label: string
  /** What the option means, shown as its tooltip. */
  readonly hint?: string
}

/** The design's segmented filter: toggle buttons in a labelled group. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  readonly options: readonly SegmentOption<T>[]
  readonly value: T
  readonly onChange: (value: T) => void
  readonly label: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex gap-1 rounded-[10px] border border-[var(--home-line-2)] bg-[var(--home-card)] p-1"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={cn(
              "whitespace-nowrap rounded-[7px] px-3 py-1.5 text-xs transition-colors",
              active
                ? "bg-[var(--home-raised-2)] font-semibold text-[var(--home-strong)]"
                : "font-medium text-[var(--home-muted)] hover:text-[var(--home-fg)]",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The panel's Dark/Light switch. It drives the same next-themes setting as the
 * sidebar's theme button, so the two can never disagree.
 *
 * The visible word names the CURRENT theme (the design's label), so it stays
 * part of the accessible name (WCAG 2.5.3) and a hidden suffix says what a
 * press does — "Dark — Switch to the light theme".
 */
export function ThemeSwitch() {
  const t = useT()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  const isLight = mounted && resolvedTheme === "light"

  return (
    <button
      type="button"
      onClick={() => setTheme(isLight ? "dark" : "light")}
      className="flex select-none items-center gap-2 text-xs text-[var(--home-muted)] transition-colors hover:text-[var(--home-fg)]"
    >
      <span className="relative inline-block h-4 w-[30px] rounded-full bg-[var(--home-raised-2)]" aria-hidden>
        <span
          className={cn(
            "absolute top-0.5 size-3 rounded-full bg-[var(--primary)] transition-[inset-inline-start] duration-150",
            isLight ? "start-4" : "start-0.5",
          )}
        />
      </span>
      {isLight ? t("home.theme.light") : t("home.theme.dark")}
      <span className="sr-only"> — {isLight ? t("home.theme.switchToDark") : t("home.theme.switchToLight")}</span>
    </button>
  )
}

const ARROW_BUTTON =
  "grid size-6 place-items-center rounded-md text-[var(--home-muted)] transition-colors hover:bg-[var(--home-raised)] hover:text-[var(--home-fg)] disabled:pointer-events-none disabled:opacity-35"

/** The ‹ › pair that pages a card row; each side disables at its edge. */
export function RowArrows({ scroller }: { readonly scroller: RowScroller }) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const BackIcon = isRtl ? ChevronRight : ChevronLeft
  const ForwardIcon = isRtl ? ChevronLeft : ChevronRight

  return (
    <span className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={scroller.scrollBack}
        disabled={!scroller.canBack}
        aria-label={t("home.scroll.back")}
        className={ARROW_BUTTON}
      >
        <BackIcon className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={scroller.scrollForward}
        disabled={!scroller.canForward}
        aria-label={t("home.scroll.forward")}
        className={ARROW_BUTTON}
      >
        <ForwardIcon className="size-4" aria-hidden />
      </button>
    </span>
  )
}

/** A quiet line where a row has nothing to show. */
export function EmptyLine({ text }: { readonly text: string }) {
  return (
    <p className="mt-3.5 rounded-xl border border-dashed border-[var(--home-line-2)] px-4 py-6 text-center text-xs text-[var(--home-muted)]">
      {text}
    </p>
  )
}

/** Placeholder cards while a row loads. */
export function SkeletonRow({ itemWidth, aspectClass }: { readonly itemWidth: number; readonly aspectClass: string }) {
  return (
    <div className="mt-3.5 flex gap-3.5 overflow-hidden" aria-hidden>
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className={cn("flex-none animate-pulse rounded-xl bg-[var(--home-raised)]", aspectClass)}
          style={{ width: itemWidth }}
        />
      ))}
    </div>
  )
}
