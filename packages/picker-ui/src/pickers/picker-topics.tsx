"use client"

import { useCallback, useId, useRef } from "react"
import { MoreHorizontal } from "lucide-react"
import { cn } from "../lib/cn"
import { characterSectionIconUrl } from "../icons/character-art"

/** One topic of an open, by-topic picker (Person, Styling): a name and its settings. */
export interface PickerTopic {
  readonly label: string
  readonly dimensions: ReadonlyArray<string>
}

/** A topic's round photo, or a neutral disc for a topic without one. */
function TopicIcon({ label, className }: { readonly label: string; readonly className: string }) {
  const icon = characterSectionIconUrl(label)
  return icon ? (
    <img
      src={icon}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("shrink-0 rounded-full border-[1.5px] border-[#e7e7ec] object-cover dark:border-[#2a2a31]", className)}
    />
  ) : (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-full bg-[#f1f1f4] dark:bg-[#1c1c21]", className)}>
      <MoreHorizontal className="size-4" />
    </span>
  )
}

function PickBadge({ count }: { readonly count: number }) {
  return (
    <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#ff0073] px-1 text-[10px] font-bold leading-none text-white">
      <span className="sr-only">{count} picked</span>
      <span aria-hidden="true">{count}</span>
    </span>
  )
}

interface PickerTopicNavProps {
  /** Accessible name of the navigation, e.g. "Person topics". */
  readonly label: string
  readonly topics: ReadonlyArray<PickerTopic>
  /** How many of each topic's settings hold a pick, by topic label. */
  readonly counts: ReadonlyMap<string, number>
  readonly onJump: (label: string) => void
}

/**
 * Jump buttons, one per topic: its round photo, its name and how many of its
 * settings are picked. They only scroll — every topic stays open below them.
 * Each button is as wide as its name, and the row wraps.
 */
export function PickerTopicNav({ label, topics, counts, onJump }: PickerTopicNavProps) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1.5">
      {topics.map((topic) => {
        const count = counts.get(topic.label) ?? 0
        return (
          <button
            key={topic.label}
            type="button"
            onClick={() => onJump(topic.label)}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border py-1 pe-2.5 ps-1 text-[12px] font-semibold transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0073]/60",
              "border-[#e7e7ec] bg-white text-[#3a3a42] hover:border-[#f4a6c8] dark:border-[#2a2a31] dark:bg-[#111114] dark:text-[#c4c4cc] dark:hover:border-[#ff3f93]/50",
            )}
          >
            <TopicIcon label={topic.label} className="size-6" />
            <span>{topic.label}</span>
            {count > 0 && <PickBadge count={count} />}
          </button>
        )
      })}
    </nav>
  )
}

/**
 * The heading over one topic's settings: round photo, name, picks so far.
 * `id` names the topic's section (aria-labelledby); the heading takes focus
 * after a jump, so a keyboard or screen-reader user lands on the topic too.
 */
export function PickerTopicHeading({ topic, count, id }: { readonly topic: PickerTopic; readonly count: number; readonly id: string }) {
  return (
    <div className="flex items-center gap-2.5 px-0.5 pt-2">
      <TopicIcon label={topic.label} className="size-[30px]" />
      <h3 id={id} tabIndex={-1} className="text-[15px] font-bold text-foreground outline-none @min-[520px]:text-[16px]">
        {topic.label}
      </h3>
      {count > 0 && <PickBadge count={count} />}
      <span className="text-[11.5px] text-[#9a9aa4] dark:text-[#7a7a85]">
        {count}/{topic.dimensions.length}
      </span>
    </div>
  )
}

/**
 * Scroll-to-topic wiring for an open, by-topic picker: a ref callback per
 * topic section, a unique heading id per topic (the section's
 * aria-labelledby), and the jump handler the nav calls. A jump scrolls the
 * topic into view and moves focus to its heading without a second scroll, so
 * the next Tab continues inside that topic.
 */
export function useTopicJump(): {
  readonly sectionRef: (label: string) => (el: HTMLElement | null) => void
  readonly headingId: (label: string) => string
  readonly jump: (label: string) => void
} {
  const prefix = useId()
  const sections = useRef(new Map<string, HTMLElement>())
  const headingId = useCallback((label: string) => `${prefix}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, [prefix])
  const sectionRef = useCallback(
    (label: string) => (el: HTMLElement | null) => {
      if (el) sections.current.set(label, el)
      else sections.current.delete(label)
    },
    [],
  )
  const jump = useCallback((label: string) => {
    const section = sections.current.get(label)
    section?.scrollIntoView({ behavior: "smooth", block: "start" })
    section?.querySelector<HTMLElement>("h3[tabindex]")?.focus({ preventScroll: true })
  }, [])
  return { sectionRef, headingId, jump }
}
