"use client"

import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { socialSearchPickTop, socialSearchPlatform, type SocialPost } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useT, type MessageKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { SocialSearchNodeData } from "@/types/nodes"
import { applySocialSearchPicks, socialSearchResults } from "@/components/nodes/social-search-run-state"
import { SOCIAL_PLATFORM_META } from "./social-platforms"
import { SocialPostCard } from "./social-post-card"

type PickerSort = "platform" | "popular" | "newest"

const SORT_LABEL: Readonly<Record<PickerSort, MessageKey>> = {
  platform: "social.sortPlatform",
  popular: "social.sortPopular",
  newest: "social.sortNewest",
}

/** One reach number per post for "most popular": views, else points, else likes. */
function reachOf(post: SocialPost): number {
  const m = post.metrics
  return m.views ?? m.score ?? (m.likes !== undefined ? m.likes * 10 : 0)
}

function timeOf(post: SocialPost): number {
  return post.publishedAt ? Date.parse(post.publishedAt) || 0 : 0
}

export function sortPickerPosts(posts: readonly SocialPost[], sort: PickerSort): SocialPost[] {
  if (sort === "popular") return [...posts].sort((a, b) => reachOf(b) - reachOf(a))
  if (sort === "newest") return [...posts].sort((a, b) => timeOf(b) - timeOf(a))
  return [...posts]
}

export function filterPickerPosts(posts: readonly SocialPost[], filter: string): SocialPost[] {
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...posts]
  return posts.filter((p) => {
    const hay = [p.title ?? "", p.text, p.author.handle, p.author.name, p.container ?? "", ...p.hashtags].join(" ").toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/**
 * The browse-and-pick window of a Social Search node: every post the last
 * search found, as cards. A person picks the posts the node passes on, in the
 * order they want them; with no picks the node passes on the first few. The
 * "keep" switch decides whether a workflow run searches again.
 */
export function SocialPostPicker({
  data,
  open,
  onOpenChange,
  onApply,
}: {
  readonly data: SocialSearchNodeData
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** Writes the node-data patch (the node's store update, or a panel's onUpdate). */
  readonly onApply: (patch: Record<string, unknown>) => void
}) {
  const t = useT()
  const results = useMemo(() => socialSearchResults(data), [data])
  const pickTop = socialSearchPickTop(data.pickTop)
  const [picked, setPicked] = useState<string[]>([])
  const [keep, setKeep] = useState(false)
  const [sort, setSort] = useState<PickerSort>("platform")
  const [filter, setFilter] = useState("")
  const [now] = useState(() => Date.now())

  // Each time the window opens it starts from what the node holds now.
  useEffect(() => {
    if (!open) return
    setPicked(Array.isArray(data.pickedIds) ? data.pickedIds.filter((id) => results.some((p) => p.id === id)) : [])
    setKeep(data.keepPicks === true)
    setFilter("")
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => filterPickerPosts(sortPickerPosts(results, sort), filter), [results, sort, filter])
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const confirm = () => {
    onApply({ ...applySocialSearchPicks(data, picked), keepPicks: keep })
    onOpenChange(false)
  }
  // An agent or a template may write a platform this build does not know.
  const platform = socialSearchPlatform(data.platform)
  const firstCount = Math.min(pickTop, results.length)
  const confirmLabel = picked.length === 0
    ? (firstCount === 1 ? t("social.useFirstOne") : t("social.useFirst", { n: firstCount }))
    : picked.length === 1
      ? t("social.usePicksOne")
      : t("social.usePicks", { n: picked.length })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-3 sm:max-w-[1040px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {SOCIAL_PLATFORM_META[platform].icon("h-4 w-4")}
            {t("social.pickerTitle", { platform: SOCIAL_PLATFORM_META[platform].name })}
          </DialogTitle>
          <DialogDescription>{pickTop === 1 ? t("social.pickerHintOne") : t("social.pickerHint", { n: pickTop })}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("social.filterPlaceholder")} className="ps-9" />
          </div>
          <div className="flex gap-1 rounded-lg border p-0.5 text-[12px] font-bold">
            {(Object.keys(SORT_LABEL) as PickerSort[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                className={cn("rounded-md px-2.5 py-1.5 transition-colors", s === sort ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t(SORT_LABEL[s])}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => setPicked(sortPickerPosts(results, sort).slice(0, pickTop).map((p) => p.id))}>
            {pickTop === 1 ? t("social.selectFirstOne") : t("social.selectFirst", { n: pickTop })}
          </Button>
          <Button variant="ghost" size="sm" disabled={picked.length === 0} onClick={() => setPicked([])}>
            {t("social.clearPicks")}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("social.noMatches")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map((post) => {
                const at = picked.indexOf(post.id)
                return (
                  <SocialPostCard key={post.id} post={post} picked={at >= 0} order={at >= 0 ? at + 1 : undefined} onToggle={() => toggle(post.id)} now={now} />
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-wrap items-center gap-3 sm:justify-between">
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Switch checked={keep} onCheckedChange={setKeep} />
            {t("social.keepOnRuns")}
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button onClick={confirm} disabled={results.length === 0}>{confirmLabel}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
