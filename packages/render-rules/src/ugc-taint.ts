/**
 * The values a published workflow never hands on at any address — its TAINTED values — read once per
 * request over the composed graph and its strip set (`ugcTaintOf`). A node that ships emptied
 * (ugc-publish-strip.ts) clears a file address in one of its settings only when it is one of them,
 * so a logo, a Lottie file or an outro the author set by its address ships and keeps working:
 * - everything a node holds whose value can flow into a creator's photo — the author's photo and
 *   everything that carries it — and everything a node holds that takes the photo itself (a
 *   component holding a UGC video, a graph that could not be read);
 * - everything a UGC node holds: what its runs made, and a My photo creator's photo;
 * - everything a library entity in the strip set holds (its pictures may be a run's, made from the
 *   video);
 * - on any other node in the strip set, everything that is not its configuration: what its runs
 *   left, its own value, a key no rule names. A copy of its input a step keeps is not a value of its
 *   own (the node it copies is read on its own), and a library pointer holds no file.
 *
 * Values compare canonical (`ugcCanonicalAddress`): a web address is the same with or without its
 * scheme, query or fragment, a default port, an upper-case host, a percent-encoded or doubled-slash
 * path, and wrapped in the platform's own image proxy or download link; an address on the platform's
 * own storage is the same on any of its hosts (`storage`, given by the deployment). An asset is the
 * same by its id or by its address — an object that holds both pairs them, anywhere in the
 * composition, so either form taints the other; an address that names a tainted asset's id is tainted
 * too. An address is read anywhere in a string, a sentence that quotes one included.
 */
import { ENTITY_NODE_KINDS, UGC_NODE_TYPES } from "@nodaro/shared"
import { LIBRARY_POINTER_KEYS, RUN_INPUT_COPY_KEYS, isRunInputCopyKey, nodeSettingKeys, ugcOwnValueKey } from "./node-settings"
import { isRunResultKey } from "./run-result-keys"
import type { UgcComposedGraph } from "./ugc-photo-influence"

/**
 * A deployment's own storage: the object an address names there (its key), whatever host or spelling
 * the address uses, or null for an address that is not on it.
 */
export type UgcStorageKey = (address: string) => string | null

/** The tainted values: canonical addresses and asset ids. */
export interface UgcTaint {
  /** Every tainted address, canonical (`ugcCanonicalAddress` with `storage`). */
  readonly addresses: ReadonlySet<string>
  /** Every tainted asset id. */
  readonly assetIds: ReadonlySet<string>
  /** The deployment's storage, as the addresses were made canonical with it. */
  readonly storage?: UgcStorageKey
}

/** A string that is an address from its start: a web, data or blob address. */
const ADDRESS = /^\s*(?:https?:|data:|blob:)/i
/**
 * An address anywhere in a string: a web address, a data or blob address, or a link through the
 * platform's own image proxy or download route (`/v1/image-proxy?url=…`, `/v1/download?url=…`).
 */
const ADDRESS_ANYWHERE = /(?<![\w.+-])(?:https?:\/\/|data:[\w.+-]+\/|blob:)[^\s"'<>)\]]*[^\s"'<>)\].,;:!?]|\/v1\/(?:image-proxy|download)\?[^\s"'<>)\]]*\burl=[^\s"'<>)\]]*[^\s"'<>)\].,;:!?]/gi
/** The platform's own wrappers around an address: the address is their `url` parameter. */
const WRAPPER = /\/v1\/(?:image-proxy|download)\?(?:[^#\s]*?&)?url=([^&#\s]+)/i
/** A key that names an asset by its id: `assetId`, `logoAssetId`, `assetIds`. */
export const UGC_ASSET_ID_KEY = /assetids?$/i
/** How deep a value is read. */
const DEPTH = 8
/** An asset id long enough to name one asset wherever it appears inside an address. */
const ID_IN_ADDRESS_MIN = 16

/** Library entities: their pictures may be a library row's or a run's, and the key cannot tell. */
export const UGC_ENTITY_NODE_TYPES: ReadonlySet<string> = new Set<string>([...ENTITY_NODE_KINDS, "face"])

/** Is this string an address from its start (a web, data or blob address)? */
export function ugcIsAddress(value: string): boolean {
  return ADDRESS.test(value)
}

/** Every address a string holds, anywhere in it. */
export function ugcAddressesIn(value: string): string[] {
  return value.match(ADDRESS_ANYWHERE) ?? []
}

/**
 * An address as it is compared (see the file comment): the address a platform wrapper carries, at any
 * depth; a data or blob address whole; a web address on the deployment's storage as `r2:<key>`;
 * any other web address without its scheme, query, fragment or default port, its host lower-case and
 * its path decoded with doubled slashes collapsed.
 */
export function ugcCanonicalAddress(value: string, storage?: UgcStorageKey): string {
  let address = value.trim()
  for (let i = 0; i < 4; i++) {
    const wrapped = WRAPPER.exec(address)
    if (!wrapped) break
    try {
      address = decodeURIComponent(wrapped[1]!.replace(/\+/g, " ")).trim()
    } catch {
      address = wrapped[1]!.trim()
    }
  }
  if (!/^https?:/i.test(address)) return address
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return address.split(/[?#]/, 1)[0]!
  }
  const stored = storage?.(url.toString())
  if (stored) return `r2:${stored}`
  let path = url.pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    /* an undecodable path is compared as it is spelled */
  }
  path = path.replace(/\/{2,}/g, "/")
  const port = url.port && url.port !== "80" && url.port !== "443" ? `:${url.port}` : ""
  return `//${url.hostname.toLowerCase()}${port}${path}`
}

/** The canonical form `taint` compares an address in. */
function canonicalIn(taint: UgcTaint, address: string): string {
  return ugcCanonicalAddress(address, taint.storage)
}

/** Is this one address tainted: its canonical form, or a tainted asset's id inside it? */
function addressTainted(taint: UgcTaint, address: string): boolean {
  if (taint.addresses.has(canonicalIn(taint, address))) return true
  for (const id of taint.assetIds) if (id.length >= ID_IN_ADDRESS_MIN && address.includes(id)) return true
  return false
}

/**
 * Is `value` tainted? A string that is an address from its start is when that address is; any other
 * string when an address inside it is, or as an asset id under a key that names one (`key`).
 */
export function ugcIsTaintedValue(taint: UgcTaint, value: string, key?: string): boolean {
  const trimmed = value.trim()
  if (trimmed === "") return false
  if (ADDRESS.test(trimmed) && addressTainted(taint, trimmed)) return true
  if (ugcAddressesIn(trimmed).some((address) => addressTainted(taint, address))) return true
  return key !== undefined && UGC_ASSET_ID_KEY.test(key) && taint.assetIds.has(trimmed)
}

/**
 * What a setting's string becomes once `strike` has read it (`strike`: is this address to go?):
 * gone, when it is such an address from its start or an asset id `drops` names (`key`); the same
 * string with each such address cut out of it, when it only quotes one; or as it is.
 */
export function ugcStruckString(value: string, key: string | undefined, strike: (address: string) => boolean, dropsAssetId: (id: string) => boolean): string | undefined {
  const trimmed = value.trim()
  if (ADDRESS.test(trimmed) && strike(trimmed)) return undefined
  if (key !== undefined && UGC_ASSET_ID_KEY.test(key) && trimmed !== "" && !ADDRESS.test(trimmed) && dropsAssetId(trimmed)) return undefined
  let cut = false
  const out = value.replace(ADDRESS_ANYWHERE, (address) => {
    if (!strike(address)) return address
    cut = true
    return ""
  })
  if (!cut) return value
  const rest = out.replace(/[ \t]{2,}/g, " ").trim()
  // A string that was nothing but such an address goes whole.
  return rest === "" ? undefined : rest
}

/** The strict rule for a string: every address goes, and every asset id. */
export function ugcStrictString(value: string, key: string | undefined): string | undefined {
  return ugcStruckString(value, key, () => true, () => true)
}

/** The taint-only rule for a string: only a tainted address or asset id goes. */
export function ugcTaintedString(taint: UgcTaint, value: string, key: string | undefined): string | undefined {
  return ugcStruckString(value, key, (address) => addressTainted(taint, address), (id) => taint.assetIds.has(id))
}

interface Collected {
  readonly addresses: Set<string>
  readonly assetIds: Set<string>
}

/** Every address and asset id in `value`, at any depth (`key`: the key it sits under). */
function collect(value: unknown, into: Collected, storage: UgcStorageKey | undefined, key?: string, depth = 0): void {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (ADDRESS.test(trimmed)) into.addresses.add(ugcCanonicalAddress(trimmed, storage))
    for (const address of ugcAddressesIn(trimmed)) into.addresses.add(ugcCanonicalAddress(address, storage))
    if (!ADDRESS.test(trimmed) && trimmed !== "" && key !== undefined && UGC_ASSET_ID_KEY.test(key)) into.assetIds.add(trimmed)
    return
  }
  if (depth > DEPTH || !value || typeof value !== "object") return
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into, storage, key, depth + 1)
    return
  }
  for (const [k, item] of Object.entries(value)) collect(item, into, storage, k, depth + 1)
}

/** Each asset id paired with the addresses an object holds beside it. */
function pairs(value: unknown, out: Array<readonly [id: string, address: string]>, storage: UgcStorageKey | undefined, depth = 0): void {
  if (depth > DEPTH || !value || typeof value !== "object") return
  if (Array.isArray(value)) {
    for (const item of value) pairs(item, out, storage, depth + 1)
    return
  }
  const ids: string[] = []
  const addresses: string[] = []
  for (const [k, item] of Object.entries(value)) {
    if (typeof item === "string") {
      const trimmed = item.trim()
      if (ADDRESS.test(trimmed)) addresses.push(ugcCanonicalAddress(trimmed, storage))
      else if (trimmed !== "" && UGC_ASSET_ID_KEY.test(k)) ids.push(trimmed)
    } else {
      pairs(item, out, storage, depth + 1)
    }
  }
  for (const id of ids) for (const address of addresses) out.push([id, address])
}

const NOT_A_VALUE: ReadonlySet<string> = new Set([...RUN_INPUT_COPY_KEYS, ...LIBRARY_POINTER_KEYS])

/**
 * Does a node in the strip set ship by the strict rule: no address and no asset id kept at all? A node
 * on a creator's photo path, one that takes the photo, a UGC node, a library entity, and a node that
 * holds a tainted value of its own (`promoted`).
 */
export function ugcStripsStrictly(type: string, onPhoto: boolean, sink: boolean, promoted = false): boolean {
  return onPhoto || sink || promoted || UGC_NODE_TYPES.has(type) || UGC_ENTITY_NODE_TYPES.has(type)
}

/** What a composed graph's strip set says, part by part (see `ugcStripSet`). */
export interface UgcTaintSources {
  readonly strip: ReadonlyMap<string, ReadonlySet<string>>
  readonly photo: ReadonlyMap<string, ReadonlySet<string>>
  readonly sinks: ReadonlyMap<string, ReadonlySet<string>>
  /** Nodes outside the first reading of the set that hold a tainted value of their own (`ugcHoldsTaint`). */
  readonly promoted?: ReadonlyMap<string, ReadonlySet<string>>
}

const dataOfNode = (node: { readonly data?: unknown }): Record<string, unknown> =>
  node.data && typeof node.data === "object" && !Array.isArray(node.data) ? (node.data as Record<string, unknown>) : {}

/** The tainted values of a composed graph (see the file comment). */
export function ugcTaintOf(composed: UgcComposedGraph, sources: UgcTaintSources, opts: { readonly storage?: UgcStorageKey } = {}): UgcTaint {
  const storage = opts.storage
  const into: Collected = { addresses: new Set(), assetIds: new Set() }
  const paired: Array<readonly [string, string]> = []
  for (const [key, part] of composed) {
    if (part.component) continue
    const strip = sources.strip.get(key)
    const photo = sources.photo.get(key)
    const sinks = sources.sinks.get(key)
    const promoted = sources.promoted?.get(key)
    for (const node of part.nodes) {
      const data = dataOfNode(node)
      pairs(data, paired, storage)
      const id = typeof node.id === "string" ? node.id : undefined
      const type = typeof node.type === "string" ? node.type : ""
      if (id === undefined) continue
      const inStrip = strip?.has(id) === true
      // A UGC node taints what it holds wherever it is (it is a root of the strip set anyway).
      if (UGC_NODE_TYPES.has(type) || (inStrip && ugcStripsStrictly(type, photo?.has(id) === true, sinks?.has(id) === true, promoted?.has(id) === true))) {
        collect(data, into, storage)
        continue
      }
      if (!inStrip) continue
      const settings = nodeSettingKeys(type, { addressSettings: true })
      for (const [k, value] of Object.entries(data)) if (!settings.has(k) && !NOT_A_VALUE.has(k) && !isRunInputCopyKey(k, type)) collect(value, into, storage, k)
    }
  }
  // Either form of an asset taints the other.
  for (let changed = true; changed; ) {
    changed = false
    for (const [id, address] of paired) {
      if (into.assetIds.has(id) && !into.addresses.has(address)) {
        into.addresses.add(address)
        changed = true
      } else if (into.addresses.has(address) && !into.assetIds.has(id)) {
        into.assetIds.add(id)
        changed = true
      }
    }
  }
  return { addresses: into.addresses, assetIds: into.assetIds, ...(storage ? { storage } : {}) }
}

/**
 * Does a node hold a tainted value OF ITS OWN — in its own value (an upload's file, a List's rows, an
 * input's value) or in what its runs left — not merely in its configuration? Such a node is the
 * author's photo or a UGC render used again (a copy of the photo's upload, a take dropped into an
 * Upload Video), and joins the strip set as a root.
 */
export function ugcHoldsTaint(taint: UgcTaint, node: { readonly type?: unknown; readonly data?: unknown }): boolean {
  const type = typeof node.type === "string" ? node.type : ""
  const own: Collected = { addresses: new Set(), assetIds: new Set() }
  for (const [k, value] of Object.entries(dataOfNode(node))) {
    if (ugcOwnValueKey(k, type) || isRunResultKey(k, type)) collect(value, own, taint.storage, k)
  }
  for (const address of own.addresses) if (taint.addresses.has(address)) return true
  for (const id of own.assetIds) if (taint.assetIds.has(id)) return true
  return false
}

/** A taint with more addresses in it (canonical as they are added). */
export function ugcWithTaintedAddresses(taint: UgcTaint, addresses: Iterable<string>): UgcTaint {
  const more = new Set(taint.addresses)
  for (const address of addresses) if (address.trim() !== "") more.add(ugcCanonicalAddress(address, taint.storage))
  return { addresses: more, assetIds: taint.assetIds, ...(taint.storage ? { storage: taint.storage } : {}) }
}
