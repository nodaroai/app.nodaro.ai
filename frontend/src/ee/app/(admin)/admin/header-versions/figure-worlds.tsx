import { cn } from "@/lib/utils"
import { BOX, BOX_STRONG, Bus, Columns, Figure, WireDown } from "./figure-parts"
import { isNotFound, linkFace, linkVerdict } from "./link-face"
import { NewTabLink, TONES } from "./product-card"
import { ACCENT_TEXT } from "./product-icon"
import type { ProductView, WorldLink, WorldsFigure } from "./types"

/**
 * "The worlds row: where each link leads". On top, the one list of worlds the
 * header holds; under it every product, which may pass its own addresses; at
 * the bottom, the sites the header's own default addresses lead to, with what
 * each address answered on this check. Which addresses a product passes is
 * not reported by the products yet, so no product is drawn leading anywhere.
 */

const GAP = 14
const GROUPS = ["simple", "advanced"] as const

type HostTone = "ok" | "bad" | "unchecked"

const HOST_LOOK: Record<HostTone, { frame: string; said: string }> = {
  ok: { frame: "border-emerald-600/60 bg-emerald-500/10", said: "Every page here answers" },
  bad: { frame: "border-destructive/60 bg-destructive/10", said: "Pages not found here" },
  unchecked: { frame: "border-amber-600/60 bg-amber-500/10", said: "Some pages could not be checked" },
}

/** The worlds grouped by the site their address leads to, in the list's order. */
function byHost(worlds: readonly WorldLink[]): { host: string; worlds: WorldLink[] }[] {
  const hosts = new Map<string, WorldLink[]>()
  for (const world of worlds) {
    const host = new URL(world.href).host
    hosts.set(host, [...(hosts.get(host) ?? []), world])
  }
  return [...hosts].map(([host, rows]) => ({ host, worlds: rows }))
}

function hostTone(worlds: readonly WorldLink[]): HostTone {
  if (worlds.some((world) => isNotFound(world.answer))) return "bad"
  return worlds.every((world) => linkFace(world.answer).tone === "newest") ? "ok" : "unchecked"
}

const pathOf = (href: string) => {
  const { pathname } = new URL(href)
  return pathname === "/" ? "" : pathname
}

function Host({ host, worlds }: { host: string; worlds: readonly WorldLink[] }) {
  const tone = hostTone(worlds)
  return (
    <div data-testid={`host-${host}`} className={cn("min-w-[15rem] rounded-lg border-2 px-4 py-3", HOST_LOOK[tone].frame)}>
      <div className="font-mono text-[15px] font-semibold">{host}</div>
      <div className="text-[12.5px]">{HOST_LOOK[tone].said}</div>
      <ul className="mt-2 space-y-1">
        {worlds.map((world) => {
          const face = linkFace(world.answer)
          return (
            <li key={world.id} className="flex items-center gap-2 text-xs">
              <span className="min-w-24 font-medium">{world.label}</span>
              <NewTabLink href={world.href} className="flex-1 font-mono text-muted-foreground">
                {pathOf(world.href) || "/"}
              </NewTabLink>
              <span data-testid={`link-${world.id}`} title={face.detail} className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", TONES[face.tone].pill)}>
                {face.label}
                {world.answer.status === "answered" && <span className="font-normal opacity-80"> {world.answer.code}</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function WorldsFigureView({ figure, worlds, products }: { figure: WorldsFigure; worlds: readonly WorldLink[]; products: readonly ProductView[] }) {
  const verdict = linkVerdict(worlds)
  return (
    <Figure id="worlds" heading={figure.heading} caption={figure.caption} minWidth={900}>
      <div className={cn(BOX_STRONG, "px-5 py-4")}>
        <div className="text-center text-[15px] font-semibold">{figure.listLabel}</div>
        <div className="mt-3 flex flex-wrap justify-center gap-x-10 gap-y-3">
          {GROUPS.map((group) => {
            const rows = worlds.filter((world) => world.group === group)
            if (rows.length === 0) return null
            const { name, note } = figure.groups[group]
            return (
              <div key={group} className="text-center">
                <div className="text-[12.5px] text-muted-foreground">{name}</div>
                <ul aria-label={name} className="mt-1.5 flex flex-wrap justify-center gap-1.5">
                  {rows.map((world) => (
                    <li key={world.id} className="rounded-full border bg-card px-3 py-1 text-[13px]">
                      {world.label}
                    </li>
                  ))}
                </ul>
                {note && <div className="mt-2 text-xs text-muted-foreground">{note}</div>}
              </div>
            )
          })}
        </div>
      </div>

      {products.length > 0 && (
        <>
          <div className="relative flex justify-center">
            <WireDown accent bare height={18} />
            <div className={cn("absolute start-[calc(50%+10px)] top-0 text-[12.5px] font-semibold", ACCENT_TEXT)}>{figure.toProducts}</div>
          </div>
          <Bus count={products.length} gap={GAP} accent />
          <Columns count={products.length} gap={GAP}>
            {products.map((product) => (
              <div key={product.id} className="flex flex-col items-center">
                <WireDown accent height={14} />
                <div className={cn(BOX, "w-full px-2 py-3 text-center")}>
                  <div className="text-[15px] font-bold">{product.label}</div>
                  <span title="Which addresses this product passes to the header is not reported yet" className="mt-2 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    Not reported yet
                  </span>
                </div>
              </div>
            ))}
          </Columns>
        </>
      )}

      <div className="mt-5 flex items-center gap-3">
        <div aria-hidden className="flex-1 border-t border-dashed border-muted-foreground/50" />
        <span className="text-[12.5px] font-semibold">{figure.toDestinations}</span>
        <div aria-hidden className="flex-1 border-t border-dashed border-muted-foreground/50" />
      </div>
      <p data-testid="world-links-verdict" className={cn("mt-2 text-center text-sm font-medium", TONES[verdict.tone].note)}>
        {verdict.text}
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-3">
        {byHost(worlds).map(({ host, worlds: rows }) => (
          <Host key={host} host={host} worlds={rows} />
        ))}
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        A site that sends the same page for every address answers even where no such page exists, so only a real “not found” shows here.
      </p>
    </Figure>
  )
}
