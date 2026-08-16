"use client"

// The Avatar Picker modal — "Choose an avatar" (design: Avatar Picker Modal).
// Opened from the AI Avatar card's "Browse all N ›": browse the HeyGen catalog
// by PERSON with search (⌘K / Ctrl+K), libraries, gender / scene facets and
// the Avatar-V toggle; the right column shows the selected look large with the
// person's other looks as chips, the details, a voice preview and "Use this
// avatar". Picking writes exactly what the on-node tiles write (the caller
// applies `avatarSelectionPatch`) and remembers the look under "Recently used".
// The caller mounts this only while open, so state initialises per opening.

import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { AlertCircle, User } from "lucide-react"
import type { HeygenAvatar } from "@/lib/api"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { keylessCatalogHint, useHeygenAvatars, useHeygenVoices } from "@/components/heygen/heygen-catalog"
import {
  DEFAULT_FILTERS,
  countOwnLooks,
  derivePersonGenders,
  deriveScenes,
  describeSelection,
  filterPeople,
  groupByPerson,
  locateLook,
  sortByRecency,
  type Person,
  type PickerFilters,
} from "./model"
import { readRecentAvatarIds, rememberRecentAvatar } from "./recent-avatars"
import { PickerHeader, type PickerView } from "./picker-header"
import { PickerRail, type LibraryEntry } from "./picker-rail"
import { PersonGrid, PAGE_SIZE } from "./person-grid"
import { LookDetail } from "./look-detail"

export interface AvatarPickerModalProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The look currently on the node — opens selected. */
  readonly value?: string
  readonly onSelect: (avatar: HeygenAvatar) => void
  /** Search text to open with (the card's search box hands its query over). */
  readonly initialQuery?: string
  /** e.g. "from 150 CR" — shown under DETAILS when the caller knows the cost. */
  readonly costLabel?: string
}

interface Selection {
  readonly personKey: string
  readonly lookId: string
}

/**
 * What the detail column shows. An explicit pick wins while its person is in
 * view; when the filters push that person out (or nothing was picked yet)
 * the column follows the view — the node's current avatar if it is in view,
 * else the first person. Null when nothing is in view.
 */
function resolveLocated(
  selection: Selection | null,
  filtered: readonly Person[],
  value: string | undefined,
): { person: Person; look: HeygenAvatar } | null {
  if (selection) {
    const person = filtered.find((p) => p.key === selection.personKey)
    if (person) return { person, look: person.looks.find((l) => l.avatarId === selection.lookId) ?? person.cover }
  }
  return locateLook(filtered, value)
}

export function AvatarPickerModal({ open, onOpenChange, value, onSelect, initialQuery, costLabel }: AvatarPickerModalProps) {
  const { data: looks, isLoading, isError, complete } = useHeygenAvatars()
  const { data: voices } = useHeygenVoices()

  const [filters, setFilters] = useState<PickerFilters>(() => ({ ...DEFAULT_FILTERS, query: initialQuery ?? "" }))
  const [view, setView] = useState<PickerView>("grid")
  const [shown, setShown] = useState(PAGE_SIZE)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [recentIds] = useState<string[]>(readRecentAvatarIds)
  const searchRef = useRef<HTMLInputElement>(null)

  const people = useMemo(() => groupByPerson(looks), [looks])
  const scenes = useMemo(() => deriveScenes(looks), [looks])
  const genders = useMemo(() => derivePersonGenders(people), [people])
  const ownLooks = useMemo(() => countOwnLooks(people), [people])

  const filtered = useMemo(() => {
    const f = filterPeople(people, filters, recentIds)
    return filters.library === "recent" ? sortByRecency(f, recentIds) : f
  }, [people, filters, recentIds])

  const located = useMemo(() => resolveLocated(selection, filtered, value), [selection, filtered, value])

  const libraries: LibraryEntry[] = useMemo(() => {
    const libs: LibraryEntry[] = [{ id: "all", label: "All avatars", count: looks.length }]
    if (ownLooks > 0) libs.push({ id: "own", label: "Your own looks", count: ownLooks })
    if (recentIds.length > 0) libs.push({ id: "recent", label: "Recently used", count: recentIds.length })
    return libs
  }, [looks.length, ownLooks, recentIds.length])

  // Every filter change starts paging from the first page again.
  const patchFilters = useCallback((patch: Partial<PickerFilters>) => {
    setFilters((f) => ({ ...f, ...patch }))
    setShown(PAGE_SIZE)
  }, [])

  const pickPerson = useCallback((person: Person) => {
    setSelection({ personKey: person.key, lookId: person.cover.avatarId })
  }, [])
  // A look chip switches the look of the person on show — also before any
  // card was clicked (the initial selection comes from the node's avatar or
  // the first person in view, not from `selection`).
  const pickLook = useCallback(
    (look: HeygenAvatar) => {
      if (located) setSelection({ personKey: located.person.key, lookId: look.avatarId })
    },
    [located],
  )
  const use = useCallback(
    (look: HeygenAvatar) => {
      rememberRecentAvatar(look.avatarId)
      onSelect(look)
      onOpenChange(false)
    },
    [onSelect, onOpenChange],
  )

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    // React Flow's delete-key listener sits on `document` and only skips real
    // inputs: with a card or chip focused, Backspace would delete the node
    // this modal was opened from (and unmount the modal with it).
    if (e.key === "Delete" || e.key === "Backspace") e.stopPropagation()
    // ⌘K / Ctrl+K focuses the search, like the header's hint says.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
  }, [])

  // Escape clears an active search first (like the card's search box); only
  // an empty search lets Radix close the dialog. Radix listens in the capture
  // phase, so this has to be its own hook, not a stopPropagation.
  const onEscape = useCallback(
    (e: Event) => {
      if (filters.query) {
        e.preventDefault()
        patchFilters({ query: "" })
      }
    },
    [filters.query, patchFilters],
  )

  const voice = located ? voices.find((v) => v.voiceId === located.look.defaultVoiceId) : undefined

  let body: ReactNode
  if (isLoading) {
    body = (
      <div className="grid grid-cols-4 gap-3.5 px-[18px] pt-4" aria-busy>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[268px] animate-pulse rounded-[11px] bg-muted/40" />
        ))}
      </div>
    )
  } else if (isError) {
    body = (
      <div className="flex flex-col items-center justify-center gap-2 text-center">
        <AlertCircle className="size-7 text-destructive/60" />
        <p className="text-sm text-muted-foreground">Failed to load avatars</p>
      </div>
    )
  } else if (looks.length === 0) {
    body = (
      <div className="flex flex-col items-center justify-center gap-2 px-8 text-center" data-testid="avatar-picker-empty">
        <User className="size-8 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">No HeyGen avatars</p>
        <p className="max-w-md text-xs text-muted-foreground/70">{keylessCatalogHint("avatars")}</p>
      </div>
    )
  } else if (filtered.length === 0) {
    body = (
      <div className="flex flex-col items-center justify-center gap-2 text-center" data-testid="avatar-picker-no-match">
        <p className="text-sm text-muted-foreground">No avatars match these filters</p>
        <button type="button" className="text-[12px] text-[#ff0073] hover:underline" onClick={() => patchFilters(DEFAULT_FILTERS)}>
          Clear search and filters
        </button>
      </div>
    )
  } else {
    body = (
      <PersonGrid
        people={filtered}
        view={view}
        selectedKey={located?.person.key}
        onPick={pickPerson}
        shown={shown}
        onMore={() => setShown((n) => n + PAGE_SIZE)}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={onKeyDown}
        onEscapeKeyDown={onEscape}
        showCloseButton={false}
        className="flex h-[min(740px,calc(100vh-40px))] w-[min(1160px,calc(100vw-40px))] max-w-none sm:max-w-none flex-col gap-0 overflow-hidden rounded-[14px] p-0"
        data-testid="avatar-picker-modal"
      >
        <PickerHeader
          ref={searchRef}
          subtitle={isLoading ? "Loading the catalog…" : `${describeSelection(filtered)}${complete ? "" : " · loading more…"}`}
          total={looks.length.toLocaleString("en-US")}
          query={filters.query}
          onQuery={(query) => patchFilters({ query })}
          view={view}
          onView={setView}
        />

        {/* Body: rail · people · detail */}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] lg:grid-cols-[208px_minmax(0,1fr)_320px]">
          <div className="hidden lg:flex lg:min-h-0 lg:flex-col">
            <PickerRail libraries={libraries} genders={genders} scenes={scenes} filters={filters} onChange={patchFilters} />
          </div>
          {body}
          {located ? (
            <LookDetail
              person={located.person}
              look={located.look}
              onPickLook={pickLook}
              onUse={use}
              voice={voice}
              costLabel={costLabel}
            />
          ) : (
            <div className="border-l border-border/60 bg-muted/20" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
