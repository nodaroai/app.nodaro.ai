import { useEffect, useState } from "react"
import { getFeaturedEntities, type FeaturedEntity } from "@nodaro/shared"
import { getCharacters, getLocations, getObjects } from "@/lib/api"
import { useT, type MessageKey } from "@/lib/i18n"

/**
 * Phase 3 cinematic — entity Library drawer (mockup screens 5/6/7).
 *
 * One drawer for Characters / Locations / Props with FEATURED (app starter
 * catalog) · MY CAST (the user's saved entities) · + NEW tabs. "Use in Shot"
 * injects the asset into the active shot's @STEMS via `onUseInShot`.
 */

export type LibraryType = "character" | "location" | "object"

const TITLE_KEYS: Record<LibraryType, MessageKey> = {
  character: "pipe.cinemaCharactersLibrary",
  location: "pipe.cinemaLocationsIndex",
  object: "pipe.cinemaPropsCatalog",
}
/** The entity noun for "Describe a new …" and its example placeholder. */
const TYPE_KEYS: Record<LibraryType, MessageKey> = {
  character: "pipe.cinemaTypeCharacter",
  location: "pipe.cinemaTypeLocation",
  object: "pipe.cinemaTypeObject",
}
const EXAMPLE_KEYS: Record<LibraryType, MessageKey> = {
  character: "pipe.cinemaExampleCharacter",
  location: "pipe.cinemaExampleLocation",
  object: "pipe.cinemaExampleObject",
}

interface MineItem {
  id: string
  name: string
  url: string | null
  description: string
}

async function fetchMine(type: LibraryType): Promise<MineItem[]> {
  const pick = <T extends { id: string; name: string; sourceImageUrl: string | null }>(
    rows: T[],
  ): MineItem[] =>
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      url: r.sourceImageUrl,
      description: (r as { canonicalDescription?: string }).canonicalDescription ?? "",
    }))
  if (type === "character") return pick((await getCharacters()).characters)
  if (type === "location") return pick((await getLocations()).locations)
  return pick((await getObjects()).objects)
}

const LABEL =
  "font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground"

export function LibraryDrawer({
  type,
  onClose,
  onUseInShot,
}: {
  type: LibraryType
  onClose: () => void
  onUseInShot?: (name: string, description: string) => void
}) {
  const t = useT()
  const [tab, setTab] = useState<"featured" | "mine" | "new">("featured")
  const [mine, setMine] = useState<MineItem[] | null>(null)
  const [newDesc, setNewDesc] = useState("")
  const featured: readonly FeaturedEntity[] = getFeaturedEntities(type)

  useEffect(() => {
    let cancelled = false
    fetchMine(type)
      .then((rows) => {
        if (!cancelled) setMine(rows)
      })
      .catch(() => {
        if (!cancelled) setMine([])
      })
    return () => {
      cancelled = true
    }
  }, [type])

  return (
    <div className="flex w-[320px] shrink-0 flex-col border-e border-[#1d1d1d] bg-[#0a0a0a] p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground">
            {t(TITLE_KEYS[type])}
          </div>
          <div className={LABEL}>{t("pipe.cinemaCreativeConstraints")}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
        >
          [X]
        </button>
      </div>

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("featured")}
          className={`rounded-md px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider ${
            tab === "featured" ? "bg-[#ff0073] text-white" : "text-muted-foreground"
          }`}
        >
          ★ {t("cfgext.voiceCatFeatured")}
        </button>
        <button
          type="button"
          onClick={() => setTab("mine")}
          className={`rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
            tab === "mine" ? "bg-[#ff0073] text-white" : "text-muted-foreground"
          }`}
        >
          + {t("pipe.cinemaMyCast", { n: mine?.length ?? 0 })}
        </button>
        <button
          type="button"
          onClick={() => setTab("new")}
          className={`rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
            tab === "new" ? "bg-[#ff0073] text-white" : "text-muted-foreground"
          }`}
        >
          + {t("common.new")}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {tab === "featured" && (
          <>
            <p className="rounded-md border border-[#2a2a2a] p-2 font-mono text-[10px] text-muted-foreground">
              <span className="text-[#ff0073]">ⓘ</span> {t("pipe.cinemaFeaturedInfoPre")}{" "}
              <span className="text-foreground">{t("pipe.cinemaUseInShotQuoted")}</span> {t("pipe.cinemaFeaturedInfoPost")}
            </p>
            {featured.map((f) => (
              <Card
                key={f.id}
                name={f.label}
                tag={t("pipe.cinemaTagStarter")}
                description={f.description}
                onUse={() => onUseInShot?.(f.label, f.description)}
              />
            ))}
          </>
        )}
        {tab === "mine" &&
          (mine === null ? (
            <p className="font-mono text-[10px] text-muted-foreground">{t("pipe.loadingLibrary")}</p>
          ) : mine.length === 0 ? (
            <p className="font-mono text-[10px] text-muted-foreground">
              {t("pipe.cinemaNothingSavedYet")}
            </p>
          ) : (
            mine.map((m) => (
              <Card
                key={m.id}
                name={m.name}
                tag={t("marketplace.tabMineShort")}
                description={m.description || t("pipe.cinemaSavedAsset")}
                thumb={m.url}
                onUse={() => onUseInShot?.(m.name, m.description)}
              />
            ))
          ))}
        {tab === "new" && (
          <div className="space-y-2">
            <span className={LABEL}>{t("pipe.cinemaDescribeNew", { type: t(TYPE_KEYS[type]) })}</span>
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={4}
              placeholder={t("pipe.cinemaExamplePrefix", { example: t(EXAMPLE_KEYS[type]) })}
              className="w-full resize-none rounded-md border border-[#2a2a2a] bg-[#111] p-2 font-mono text-[11px] text-foreground outline-none focus:border-[#ff0073]"
            />
            <button
              type="button"
              disabled={!newDesc.trim()}
              onClick={() => {
                onUseInShot?.(`new ${type}`, newDesc)
                setNewDesc("")
              }}
              className="w-full rounded-md bg-[#ff0073] py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-40"
            >
              {t("pipe.cinemaUseInShot")}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Card({
  name,
  tag,
  description,
  thumb,
  onUse,
}: {
  name: string
  tag: string
  description: string
  thumb?: string | null
  onUse: () => void
}) {
  const t = useT()
  return (
    <div className="group rounded-md border border-[#2a2a2a] bg-[#111] p-2 hover:border-[#ff0073]/50">
      <div className="flex gap-2">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-[#1a1a1a]">
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-mono text-[8px] text-muted-foreground">
              @
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate font-mono text-[11px] font-bold text-foreground">
              @{name.replace(/\s+/g, "")}
            </span>
            <span className="shrink-0 font-mono text-[8px] uppercase tracking-wider text-muted-foreground">
              {tag}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onUse}
        className="mt-2 hidden w-full rounded bg-[#ff0073]/15 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-[#ff0073] group-hover:block"
      >
        {t("pipe.cinemaUseInShot")}
      </button>
    </div>
  )
}
