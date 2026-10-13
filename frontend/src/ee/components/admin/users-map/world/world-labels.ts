import type * as THREE from "three"
import { layoutLabels, type Box, type LabelIn } from "../label-layout"
import type { WorldAccount, WorldView } from "./create-world"

/**
 * The HTML laid over the floor: a chip per cluster, the "Regular users" sign,
 * the selected account's tag and the hover tooltip. Built with DOM nodes and
 * textContent only — emails are people's input and never become markup.
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

interface ClusterChip {
  readonly root: HTMLDivElement
  readonly stem: HTMLDivElement
  readonly badge: HTMLSpanElement
  readonly count: HTMLSpanElement
  readonly bar: [HTMLElement, HTMLElement]
  /** "+N new" — members that signed up within the hour. */
  readonly fresh: HTMLSpanElement
  signature: string
}

export interface PlaceArgs {
  readonly view: WorldView
  readonly toScreen: (p: THREE.Vector3) => [number, number]
  readonly clusterAnchor: (key: string) => THREE.Vector3 | null
  readonly singlesAnchor: () => THREE.Vector3 | null
  readonly accountAnchor: THREE.Vector3 | null
  readonly width: number
  readonly height: number
}

export function createLabels(host: HTMLElement, onCluster: (key: string) => void) {
  const layer = el("div", "um-labels")
  host.appendChild(layer)
  const chips = new Map<string, ClusterChip>()

  const singles = el("div", "um-label um-singles")
  const singlesCount = el("span", "um-singles-count")
  singles.append(el("b", "", "Regular users"), singlesCount)
  layer.appendChild(singles)

  const account = el("div", "um-label um-account-tag")
  const accountEmail = el("span", "um-account-email")
  const accountState = el("span", "um-account-state")
  const accountPill = el("div", "um-account-pill")
  accountPill.append(accountEmail, accountState)
  account.append(accountPill, el("div", "um-account-stem"))
  layer.appendChild(account)

  const tip = el("div", "um-tip")
  const tipEmail = el("span", "")
  const tipMeta = el("span", "um-tip-meta")
  tip.append(tipEmail, tipMeta)
  layer.appendChild(tip)

  function chipFor(key: string): ClusterChip {
    const existing = chips.get(key)
    if (existing) return existing
    const root = el("div", "um-label um-chip-wrap")
    const chip = el("div", "um-chip")
    const badge = el("span", "um-chip-badge")
    const count = el("span", "um-chip-count")
    const bar = el("span", "um-chip-bar")
    const granted = el("i", "")
    const withheld = el("i", "")
    granted.style.background = "#3fb36b"
    withheld.style.background = "#8d99b2"
    bar.append(granted, withheld)
    const fresh = el("span", "um-chip-new")
    fresh.style.display = "none"
    chip.append(badge, el("span", "um-chip-title", "One person"), count, bar, fresh)
    const stem = el("div", "um-chip-stem")
    root.append(chip, stem)
    root.addEventListener("click", (e) => {
      e.stopPropagation()
      onCluster(key)
    })
    layer.appendChild(root)
    const made: ClusterChip = { root, stem, badge, count, bar: [granted, withheld], fresh, signature: "" }
    chips.set(key, made)
    return made
  }

  /** Content and visibility; positions come every frame from `place`. */
  function render(view: WorldView, singleCount: number) {
    const keep = new Set(view.clusters.map((c) => c.key))
    for (const [key, chip] of chips) {
      if (keep.has(key)) continue
      chip.root.remove()
      chips.delete(key)
    }
    for (const c of view.clusters) {
      const chip = chipFor(c.key)
      const selected = view.selectedCluster === c.key
      const signature = `${c.id}|${c.size}|${c.granted}|${c.withheld}|${c.fresh}|${selected}|${c.hue}`
      if (chip.signature !== signature) {
        chip.signature = signature
        chip.badge.textContent = `#${c.id}`
        chip.badge.style.background = c.hue
        chip.count.textContent = `${c.size} accounts`
        chip.fresh.textContent = c.fresh > 0 ? `+${c.fresh} new` : ""
        chip.fresh.style.display = c.fresh > 0 ? "" : "none"
        chip.bar[0].style.width = `${(c.granted / Math.max(1, c.size)) * 100}%`
        chip.bar[1].style.width = `${(c.withheld / Math.max(1, c.size)) * 100}%`
        chip.root.classList.toggle("is-selected", selected)
      }
      chip.root.style.opacity = view.selectedCluster && !selected ? "0.5" : "1"
      chip.root.style.display = c.visible ? "block" : "none"
    }
    singlesCount.textContent = `one person, one screen · ${singleCount}`
    singles.style.display = singleCount > 0 && (view.show === "all" || view.show === "legit") ? "block" : "none"
    const sel = view.selected?.type === "account" ? view.accounts.find((a) => a.id === (view.selected as { id: string }).id) : undefined
    account.style.display = sel ? "block" : "none"
    if (sel) {
      accountEmail.textContent = sel.email
      accountState.textContent = sel.stateLabel
    }
  }

  function place(args: PlaceArgs) {
    const hostBox = host.getBoundingClientRect()
    const huds: Box[] = [...(host.parentElement ?? host).querySelectorAll<HTMLElement>("[data-hud]")]
      .filter((n) => n.offsetParent !== null && getComputedStyle(n).opacity !== "0")
      .map((n) => {
        const b = n.getBoundingClientRect()
        return { l: b.left - hostBox.left - 4, t: b.top - hostBox.top - 4, r: b.right - hostBox.left + 4, b: b.bottom - hostBox.top + 4 }
      })
    const nodes: HTMLElement[] = []
    const items: LabelIn[] = []
    const stems: Array<HTMLElement | null> = []
    for (const c of args.view.clusters) {
      const chip = chips.get(c.key)
      const anchor = args.clusterAnchor(c.key)
      if (!chip || !anchor || chip.root.style.display === "none") continue
      const [x, y] = args.toScreen(anchor)
      nodes.push(chip.root)
      stems.push(chip.stem)
      items.push({ x, y, w: chip.root.offsetWidth, h: chip.root.offsetHeight, selected: args.view.selectedCluster === c.key })
    }
    const singlesAt = singles.style.display !== "none" ? args.singlesAnchor() : null
    if (singlesAt) {
      const [x, y] = args.toScreen(singlesAt)
      nodes.push(singles)
      stems.push(null)
      items.push({ x, y, w: singles.offsetWidth, h: singles.offsetHeight, selected: false })
    }
    const placed = layoutLabels(items, huds, args.width, args.height)
    placed.forEach((p, i) => {
      const node = nodes[i]!
      node.style.visibility = p.visible ? "visible" : "hidden"
      node.style.transform = `translate(${p.left}px, ${p.top}px)`
      const stem = stems[i]
      if (stem) stem.style.opacity = p.atAnchor ? "1" : "0"
    })
    if (args.accountAnchor && account.style.display !== "none") {
      const [x, y] = args.toScreen(args.accountAnchor)
      account.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`
    }
  }

  function showTip(t: { account: WorldAccount; x: number; y: number } | null) {
    if (!t) {
      tip.style.display = "none"
      return
    }
    const a = t.account
    tip.style.display = "flex"
    tip.style.transform = `translate(${t.x}px, ${t.y}px)`
    tipEmail.textContent = a.email
    tipMeta.textContent = [a.quiet ? "Quietly stopped" : "", a.actLabel, a.stateLabel, a.why].filter(Boolean).join(" · ")
  }

  return { render, place, tip: showTip, dispose: () => layer.remove() }
}
