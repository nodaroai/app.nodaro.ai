import { useState } from "react"
import { AlertTriangle, type LucideIcon, X } from "lucide-react"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import { BOX } from "./figure-parts"
import { byHost, HOST_LOOK, hostTone, pathOf } from "./hosts"
import { isNotFound, linkFace, linkVerdict } from "./link-face"
import { ENVIRONMENT_LOOK, hostWithBreaks, NewTabLink, TONES } from "./product-card"
import { ProductIcon } from "./product-icon"
import { ENVIRONMENTS } from "./site-face"
import type { ProductView, SiteEnvironment, SiteView, SiteWorldLink } from "./types"

/**
 * Where each product's worlds row leads, on its live sites or on its test
 * sites, as each site says itself: one product per row, a wire from it to
 * every site its links reach, the worlds that go there riding the wire. A
 * world drawn solid is an address the product gives itself; dashed, the
 * header's own (the product gives none). Each world is coloured by what its
 * address answered.
 */

const WIRE = "bg-primary"

type ChipTone = "ok" | "bad" | "unchecked"

/** A world on its wire: a link to where it leads, coloured by the answer, and marked when it is not well (never colour alone). */
const CHIP_LOOK: Record<ChipTone, { frame: string; mark: LucideIcon | null }> = {
  ok: { frame: "border-emerald-600/60 bg-emerald-500/10", mark: null },
  bad: { frame: "border-destructive/70 bg-destructive/10 text-destructive", mark: X },
  unchecked: { frame: "border-amber-600/60 bg-amber-500/10", mark: AlertTriangle },
}

function chipTone(link: SiteWorldLink): ChipTone {
  if (isNotFound(link.answer)) return "bad"
  return linkFace(link.answer).tone === "newest" ? "ok" : "unchecked"
}

function Chip({ productId, link, label }: { productId: string; link: SiteWorldLink; label: string }) {
  const face = linkFace(link.answer)
  const whose = link.own ? "the product's own address" : "the header's own address"
  const tone = chipTone(link)
  const Mark = CHIP_LOOK[tone].mark
  return (
    <li>
      <NewTabLink
        href={link.href}
        className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", link.own ? "border-solid" : "border-dashed", CHIP_LOOK[tone].frame)}
      >
        {Mark && <Mark aria-hidden className="h-3 w-3 shrink-0" />}
        <span data-testid={`route-${productId}-${link.id}`} data-own={link.own} data-answer={tone} title={`${link.href} (${whose}): ${face.label}, ${face.detail}`}>
          {label}
        </span>
        <span className="sr-only">
          : {link.href}, {whose}, {face.label}
        </span>
      </NewTabLink>
    </li>
  )
}

/** The wire's end at the site, pointing the reading way. */
function ArrowHead() {
  const rtl = useAppDir() === "rtl"
  return (
    <svg aria-hidden width="8" height="12" viewBox="0 0 8 12" className={cn("relative ms-auto shrink-0 fill-primary", rtl && "rotate-180")}>
      <path d="M0 0 L8 6 L0 12 z" />
    </svg>
  )
}

function Branch({ productId, host, links, labels, first, last }: { productId: string; host: string; links: readonly SiteWorldLink[]; labels: ReadonlyMap<string, string>; first: boolean; last: boolean }) {
  const tone = hostTone(links)
  const paths = [...new Set(links.map((link) => pathOf(link.href)))]
  return (
    <li className="relative flex items-center py-1">
      {/* The spine the branches leave from: each branch draws its half above and below. */}
      {!first && <span aria-hidden className={cn("absolute start-0 top-0 h-1/2 w-0.5", WIRE)} />}
      {!last && <span aria-hidden className={cn("absolute bottom-0 start-0 h-1/2 w-0.5", WIRE)} />}
      <div className="relative flex min-w-0 flex-1 items-center self-stretch">
        <span aria-hidden className={cn("absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2", WIRE)} />
        <ul aria-label={`To ${host}`} className="relative mx-5 flex flex-wrap gap-1 rounded-md bg-background px-1 py-1">
          {links.map((link) => (
            <Chip key={link.id} productId={productId} link={link} label={labels.get(link.id) ?? link.id} />
          ))}
        </ul>
        <ArrowHead />
      </div>
      <div data-testid={`route-host-${productId}-${host}`} className={cn("w-56 shrink-0 rounded-lg border-2 px-3 py-2", HOST_LOOK[tone].frame)}>
        <div className="font-mono text-[13px] font-semibold">{host}</div>
        <div className="truncate font-mono text-[11px] text-muted-foreground" title={paths.join("  ")}>
          {paths.join("  ")}
        </div>
        <div className="text-xs">{HOST_LOOK[tone].said}</div>
      </div>
    </li>
  )
}

/** A site whose row leads nowhere this page can draw: no file, a file it cannot read, or a hidden row. */
function quietOf(site: SiteView): { title: string; note: string; bad: boolean } | null {
  const { worlds } = site
  if (worlds.status === "not_reported") return { title: "Not reported yet", note: `${site.host} does not publish /shell-worlds.json yet.`, bad: false }
  if (worlds.status === "no_answer") return { title: "No answer", note: `${site.host} did not answer for /shell-worlds.json; asked again on the next check.`, bad: false }
  if (worlds.status === "invalid") return { title: "Its file cannot be read", note: worlds.message, bad: true }
  if (!worlds.worldsRow) return { title: "Worlds row hidden", note: "This site shows no worlds row, so it links to none.", bad: false }
  return worlds.links.length === 0 ? { title: "No worlds", note: "The header lists no worlds.", bad: false } : null
}

function ProductRoutes({ product, site, labels }: { product: ProductView; site: SiteView; labels: ReadonlyMap<string, string> }) {
  const quiet = quietOf(site)
  const branches = site.worlds.status === "reported" ? byHost(site.worlds.links) : []
  return (
    <li data-testid={`routes-${product.id}`} className="grid grid-cols-[9.5rem_minmax(0,1fr)] items-center">
      <div className="flex items-center">
        <div className={cn(BOX, "min-w-0 flex-1 px-2 py-2.5 text-center")}>
          <ProductIcon icon={product.icon} label={product.label} />
          <div className="text-[15px] font-bold">{product.label}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{hostWithBreaks(site.host)}</div>
        </div>
        <span aria-hidden className={cn("h-0.5 w-4 shrink-0", quiet ? "border-t-2 border-dashed border-muted-foreground/50" : WIRE)} />
      </div>
      {quiet ? (
        <div data-testid={`routes-quiet-${product.id}`} className="flex items-center">
          <span aria-hidden className="w-10 border-t-2 border-dashed border-muted-foreground/50" />
          <div className={cn("rounded-lg border border-dashed px-3 py-2", quiet.bad ? "border-destructive/60" : "border-muted-foreground/50")}>
            <div className={cn("text-[13px] font-semibold", quiet.bad ? "text-destructive" : "text-muted-foreground")}>{quiet.title}</div>
            <div className="text-xs text-muted-foreground">{quiet.note}</div>
          </div>
        </div>
      ) : (
        <ul aria-label={`Where ${product.label}'s links lead`}>
          {branches.map(({ host, links }, index) => (
            <Branch key={host} productId={product.id} host={host} links={links} labels={labels} first={index === 0} last={index === branches.length - 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Every address a set of sites leads to, once. */
function distinct(products: readonly ProductView[], environment: SiteEnvironment): SiteWorldLink[] {
  const links = products.flatMap(({ sites }) => {
    const { worlds } = sites[environment]
    return worlds.status === "reported" ? worlds.links : []
  })
  return [...new Map(links.map((link) => [link.href, link])).values()]
}

export function WorldRoutes({ products, labels }: { products: readonly ProductView[]; labels: ReadonlyMap<string, string> }) {
  const [environment, setEnvironment] = useState<SiteEnvironment>("production")
  const reached = distinct(products, environment)
  const verdict = linkVerdict(reached)
  return (
    <div className="mt-2 space-y-3">
      <div role="group" aria-label="Which sites" className="flex justify-center gap-2">
        {ENVIRONMENTS.map((env) => {
          const look = ENVIRONMENT_LOOK[env]
          const Icon = look.icon
          const on = env === environment
          return (
            <button
              key={env}
              type="button"
              aria-pressed={on}
              onClick={() => setEnvironment(env)}
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium", on ? look.frame : "border-transparent text-muted-foreground hover:bg-muted")}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {look.label} sites
            </button>
          )
        })}
      </div>
      {reached.length > 0 && (
        <p data-testid="routes-verdict" className={cn("text-center text-sm font-medium", TONES[verdict.tone].note)}>
          {verdict.text}
        </p>
      )}
      <ul aria-label={`Where each product's links lead, ${ENVIRONMENT_LOOK[environment].label.toLowerCase()} sites`} className="space-y-4">
        {products.map((product) => (
          <ProductRoutes key={product.id} product={product} site={product.sites[environment]} labels={labels} />
        ))}
      </ul>
      <p className="text-center text-xs text-muted-foreground">
        <span className="me-1 inline-block rounded-full border border-muted-foreground/60 px-2">Solid</span>
        the product&apos;s own address ·
        <span className="mx-1 inline-block rounded-full border border-dashed border-muted-foreground/60 px-2">Dashed</span>
        the header&apos;s own (the product gives none)
      </p>
    </div>
  )
}
