"use client"

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { BadgeCheck, Loader2, Plus, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { CachedImage } from "@/components/ui/cached-image"
import { META_ADS_ADVERTISER_MAX_RESULTS, META_ADS_SCRAPE_MAX_SOURCES, metaAdsAdvertisersFrom, type MetaAdsAdvertiser } from "@nodaro/shared/social"
import { metaAdsAdvertisers } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * The Meta Ads node's advertiser picker — the Ad Library's own search box,
 * in the panel: type a name, get the Facebook Pages that match it (avatar,
 * name, verified badge), add up to `META_ADS_SCRAPE_MAX_SOURCES`. Picks are
 * stored on the node and run as their Page urls.
 *
 * A lookup is an explicit action (Find / Enter), not a keystroke debounce:
 * each one is an actor run on the platform (~5 s), metered per user.
 */
export function MetaAdsAdvertiserPicker({
  selected,
  onChange,
}: {
  readonly selected: MetaAdsAdvertiser[]
  readonly onChange: (next: MetaAdsAdvertiser[]) => void
}) {
  const t = useT()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<MetaAdsAdvertiser[]>([])
  const [status, setStatus] = useState<"idle" | "searching" | "done" | "error">("idle")
  // The server's line when it has one (a missing key says what to do, a
  // limit says when to retry); the generic line otherwise.
  const [errorText, setErrorText] = useState<string | null>(null)
  // Only the LATEST lookup may paint — a slow earlier answer, or one landing
  // after the panel closed, is dropped.
  const requestRef = useRef(0)
  useEffect(() => () => { requestRef.current += 1 }, [])

  const picked = new Set(selected.map((a) => a.pageId))
  const atCap = selected.length >= META_ADS_SCRAPE_MAX_SOURCES
  const trimmed = query.trim()

  const find = async () => {
    if (trimmed.length < 2 || status === "searching") return
    const id = ++requestRef.current
    setStatus("searching")
    setErrorText(null)
    try {
      const { advertisers } = await metaAdsAdvertisers(trimmed)
      if (id !== requestRef.current) return
      setResults(metaAdsAdvertisersFrom(advertisers, META_ADS_ADVERTISER_MAX_RESULTS))
      setStatus("done")
    } catch (err) {
      if (id !== requestRef.current) return
      setResults([])
      setErrorText(err instanceof Error && err.message ? err.message : null)
      setStatus("error")
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      void find()
    }
  }

  const add = (a: MetaAdsAdvertiser) => {
    if (picked.has(a.pageId) || atCap) return
    onChange([...selected, a])
  }
  const remove = (pageId: string) => onChange(selected.filter((a) => a.pageId !== pageId))

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((a) => (
            <AdvertiserChip key={a.pageId} advertiser={a} onRemove={() => remove(a.pageId)} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2.5 rounded-xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-3)] px-3.5 py-1">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--meta-ads-faint)]" aria-hidden />
        <Input
          id="meta-ads-advertiser-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("cfgext.metaAdsAdvertiserPh")}
          aria-label={t("cfgext.metaAdsAdvertiserPh")}
          className="h-9 flex-1 border-0 bg-transparent px-0 text-[14px] font-semibold text-[var(--meta-ads-text)] shadow-none focus-visible:ring-0"
        />
        <button
          type="button"
          onClick={() => void find()}
          disabled={trimmed.length < 2 || status === "searching"}
          aria-label={t("cfgext.metaAdsAdvertiserFind")}
          className="shrink-0 rounded-full bg-[var(--meta-ads-cta-bg)] px-3 py-1.5 text-[11.5px] font-extrabold text-[var(--meta-ads-cta-fg)] transition-opacity disabled:opacity-40"
        >
          {status === "searching" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : t("cfgext.metaAdsAdvertiserFind")}
        </button>
      </div>

      <p role="status" aria-live="polite" className={cn("text-[11.5px] font-semibold", status === "error" ? "text-[#FF0073]" : "text-[var(--meta-ads-muted)]", status === "idle" && "hidden")}>
        {status === "searching" && t("cfgext.metaAdsAdvertiserSearching")}
        {status === "error" && (errorText ?? t("cfgext.metaAdsAdvertiserFailed"))}
        {status === "done" && results.length === 0 && t("cfgext.metaAdsAdvertiserNone")}
        {status === "done" && results.length > 0 && t("cfgext.metaAdsAdvertiserCount", { count: results.length })}
      </p>

      {status === "done" && results.length > 0 && (
        <ul className="flex flex-col overflow-hidden rounded-xl border border-[var(--meta-ads-border)]" aria-label={t("cfgext.metaAdsAdvertisers")}>
          {results.map((a) => (
            <AdvertiserRow key={a.pageId} advertiser={a} added={picked.has(a.pageId)} atCap={atCap} onAdd={() => add(a)} />
          ))}
        </ul>
      )}

      <p className="text-[11.5px] leading-normal text-[var(--meta-ads-faint)]">
        {t("cfgext.metaAdsAdvertiserHelp", { max: META_ADS_SCRAPE_MAX_SOURCES })}
      </p>
    </div>
  )
}

/** A picked advertiser: avatar, name, badge, remove. */
function AdvertiserChip({ advertiser, onRemove }: { readonly advertiser: MetaAdsAdvertiser; readonly onRemove: () => void }) {
  const t = useT()
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-[var(--meta-ads-accent-border)] bg-[var(--meta-ads-accent-tint)] py-1 pe-1.5 ps-1 text-[12px] font-bold text-[var(--meta-ads-text)]">
      <Avatar advertiser={advertiser} size={18} />
      <span className="max-w-[160px] truncate">{advertiser.name}</span>
      {advertiser.verified && <VerifiedBadge />}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${t("cfgext.metaAdsAdvertiserRemove")} ${advertiser.name}`}
        className="rounded-full p-0.5 text-[var(--meta-ads-muted)] hover:text-[#FF0073]"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  )
}

/** One lookup match: avatar, name, badge / page id, Add. */
function AdvertiserRow({
  advertiser,
  added,
  atCap,
  onAdd,
}: {
  readonly advertiser: MetaAdsAdvertiser
  readonly added: boolean
  readonly atCap: boolean
  readonly onAdd: () => void
}) {
  const t = useT()
  return (
    <li className="flex items-center gap-2.5 border-b border-[var(--meta-ads-divider)] px-3 py-2 last:border-b-0">
      <Avatar advertiser={advertiser} size={28} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1 truncate text-[13px] font-bold text-[var(--meta-ads-text)]">
          <span className="truncate">{advertiser.name}</span>
          {advertiser.verified && <VerifiedBadge />}
        </span>
        <span className="truncate text-[11px] text-[var(--meta-ads-faint)]">
          {advertiser.verified ? t("cfgext.metaAdsAdvertiserVerified") : advertiser.pageId}
        </span>
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={added || atCap}
        aria-label={`${added ? t("cfgext.metaAdsAdvertiserAdded") : t("cfgext.metaAdsAdvertiserAdd")} ${advertiser.name}`}
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition-colors",
          added
            ? "border-[var(--meta-ads-accent-border)] bg-[var(--meta-ads-accent-tint)] text-[#FF0073]"
            : "border-[var(--meta-ads-border)] text-[var(--meta-ads-text-2)] hover:text-[var(--meta-ads-text)] disabled:opacity-40",
        )}
      >
        {added ? t("cfgext.metaAdsAdvertiserAdded") : (<><Plus className="h-3 w-3" aria-hidden />{t("cfgext.metaAdsAdvertiserAdd")}</>)}
      </button>
    </li>
  )
}

function VerifiedBadge() {
  const t = useT()
  return <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-[var(--meta-ads-info)]" role="img" aria-label={t("cfgext.metaAdsAdvertiserVerified")} />
}

/** The Page's avatar (Meta's CDN, so it rides the image proxy) or its initial. */
function Avatar({ advertiser, size }: { readonly advertiser: MetaAdsAdvertiser; readonly size: number }) {
  const initial = advertiser.name.trim().charAt(0).toUpperCase() || "?"
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--meta-ads-chip)] text-[11px] font-extrabold text-[var(--meta-ads-text-2)]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {advertiser.imageUrl ? <CachedImage src={advertiser.imageUrl} alt="" className="h-full w-full object-cover" /> : initial}
    </span>
  )
}
