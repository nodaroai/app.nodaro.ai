"use client"

// Centre of the Avatar Picker modal: one card per PERSON (grid) or one row
// (list), the "N looks" count, the check on the selected person, the violet
// Avatar-V tag, the build status of the account's own looks, and "Load 24
// more". The cards form one radiogroup: a single tab stop, arrow keys move
// the selection (see use-roving-radiogroup.ts), Enter / Space pick.

import { Check, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { CachedImage } from "@/components/ui/cached-image"
import { useLazyMount } from "@/components/audio-player/use-lazy-mount"
import { avatarStatusLabel } from "@/components/heygen/heygen-catalog"
import { personMeta, type Person } from "./model"
import { V_TAG } from "./styles"
import { useRovingRadiogroup, type RovingItemProps } from "./use-roving-radiogroup"

export const PAGE_SIZE = 24

interface PersonGridProps {
  readonly people: readonly Person[]
  readonly view: "grid" | "list"
  readonly selectedKey: string | undefined
  readonly onPick: (person: Person) => void
  /** How many people are rendered; the rest sit behind "Load 24 more". */
  readonly shown: number
  readonly onMore: () => void
}

const looksCount = (person: Person) => `${person.looks.length} ${person.looks.length === 1 ? "look" : "looks"}`

/** The accessible name carries what the eye gets from the card: name, meta,
 *  count and — for the account's own looks — the build status. */
function accessibleName(person: Person): string {
  return [person.name, personMeta(person), looksCount(person), avatarStatusLabel(person.cover)].filter(Boolean).join(", ")
}

function VTag({ person, className }: { person: Person; className?: string }) {
  if (!person.supportsV) return null
  return (
    <span className={cn(V_TAG, "size-[18px] pointer-events-none", className)} title="Supports Avatar V" aria-hidden>
      <Sparkles className="size-2.5" />
    </span>
  )
}

function StatusBadge({ person, className }: { person: Person; className?: string }) {
  const status = avatarStatusLabel(person.cover)
  if (!status) return null
  return (
    <span className={cn("rounded-[5px] px-1.5 py-0.5 text-[9px] font-bold text-white pointer-events-none", status === "Failed" ? "bg-red-600/90" : "bg-amber-500/90", className)} aria-hidden>
      {status}
    </span>
  )
}

interface ItemProps {
  readonly person: Person
  readonly selected: boolean
  readonly onPick: () => void
  readonly roving: RovingItemProps
}

function PersonCard({ person, selected, onPick, roving }: ItemProps) {
  const { ref, mounted } = useLazyMount("300px")
  return (
    // role="presentation": the wrapper only hosts the lazy-mount observer, so
    // the radiogroup's children stay the radios themselves.
    <div ref={ref} role="presentation">
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={accessibleName(person)}
        onClick={onPick}
        {...roving}
        className={cn(
          "group flex w-full flex-col overflow-hidden rounded-[11px] border text-left transition-colors",
          selected
            ? "border-[#ff0073]/70 bg-muted/60 shadow-[0_0_0_1px_rgba(255,0,115,0.3)]"
            : "border-border/70 bg-card hover:bg-muted/50 hover:border-foreground/25",
        )}
      >
        <div className="relative h-[208px] w-full overflow-hidden bg-muted/40">
          {mounted ? (
            <CachedImage
              src={person.cover.previewImageUrl}
              alt=""
              thumbnail
              thumbnailWidth={320}
              className="h-full w-full object-cover object-top transition-transform duration-200 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="h-full w-full animate-pulse bg-muted/60" />
          )}
          <VTag person={person} className="absolute left-2 top-2" />
          <span className="absolute bottom-2 left-2 rounded-[5px] bg-black/80 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.06em] text-zinc-200 whitespace-nowrap pointer-events-none" aria-hidden>
            {looksCount(person)}
          </span>
          <StatusBadge person={person} className="absolute left-2 top-8" />
          <span
            aria-hidden
            className={cn(
              "absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-[#ff0073] text-white transition-opacity",
              selected ? "opacity-100" : "opacity-0",
            )}
          >
            <Check className="size-3" />
          </span>
        </div>
        <div className="min-w-0 px-[11px] pb-[11px] pt-[9px]" aria-hidden>
          <div className="truncate text-[13px] text-foreground">{person.name}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{personMeta(person)}</div>
        </div>
      </button>
    </div>
  )
}

function PersonRow({ person, selected, onPick, roving }: ItemProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={accessibleName(person)}
      onClick={onPick}
      {...roving}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors",
        selected ? "border-[#ff0073]/70 bg-muted/60" : "border-border/60 bg-card hover:bg-muted/50",
      )}
    >
      <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted/40" aria-hidden>
        <CachedImage src={person.cover.previewImageUrl} alt="" thumbnail thumbnailWidth={96} className="h-full w-full object-cover object-top" />
      </span>
      <span className="min-w-0 flex-1" aria-hidden>
        <span className="block truncate text-[13px] text-foreground">{person.name}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{personMeta(person)}</span>
      </span>
      <StatusBadge person={person} />
      <span className="font-mono text-[10px] text-muted-foreground/70 whitespace-nowrap" aria-hidden>
        {looksCount(person)}
      </span>
      <VTag person={person} />
      <span className={cn("grid size-5 place-items-center rounded-full bg-[#ff0073] text-white", selected ? "opacity-100" : "opacity-0")} aria-hidden>
        <Check className="size-3" />
      </span>
    </button>
  )
}

export function PersonGrid({ people, view, selectedKey, onPick, shown, onMore }: PersonGridProps) {
  const visible = people.slice(0, shown)
  const remaining = people.length - visible.length
  const activeIndex = visible.findIndex((p) => p.key === selectedKey)
  const roving = useRovingRadiogroup(visible.length, activeIndex, (i) => onPick(visible[i]))
  return (
    <div className="min-w-0 overflow-y-auto px-[18px] pb-[22px] pt-4" data-testid="avatar-picker-grid">
      <div
        role="radiogroup"
        aria-label="People"
        className={cn(view === "grid" ? "grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-4" : "flex flex-col gap-1.5")}
        data-view={view}
      >
        {visible.map((p, i) =>
          view === "grid" ? (
            <PersonCard key={p.key} person={p} selected={p.key === selectedKey} onPick={() => onPick(p)} roving={roving(i)} />
          ) : (
            <PersonRow key={p.key} person={p} selected={p.key === selectedKey} onPick={() => onPick(p)} roving={roving(i)} />
          ),
        )}
      </div>
      {remaining > 0 && (
        <button
          type="button"
          onClick={onMore}
          className="mt-4 grid w-full place-items-center rounded-[9px] border border-border/70 py-[11px] text-[12.5px] text-foreground/80 hover:bg-muted/50"
        >
          Load {Math.min(PAGE_SIZE, remaining)} more
        </button>
      )}
    </div>
  )
}
