#!/usr/bin/env node
/**
 * Refresh `backend/src/lib/hosting-ranges.generated.json` — the address
 * ranges the big hosting providers publish themselves — for the free-grant
 * gate's "a server is not a person" rule (lib/hosting-ranges.ts).
 *
 * Sources are the providers' OWN published lists, fetched live; nothing is
 * inferred. A provider that publishes no list (Leaseweb) is read from the
 * routes its own registered networks announce (RIPEstat), each network's
 * holder checked. Run it when the list is stale (monthly is plenty — the ranges
 * move slowly) and commit the result:
 *
 *   node backend/scripts/update-hosting-ranges.mjs
 *
 * Azure is not here: Microsoft publishes its service tags behind a download
 * page whose link changes weekly, with no stable URL. Add it when there is one.
 */
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "hosting-ranges.generated.json")

const SOURCES = [
  { name: "aws", url: "https://ip-ranges.amazonaws.com/ip-ranges.json", kind: "aws" },
  { name: "gcp", url: "https://www.gstatic.com/ipranges/cloud.json", kind: "gcp" },
  { name: "oracle", url: "https://docs.oracle.com/en-us/iaas/tools/public_ip_ranges.json", kind: "oracle" },
  { name: "digitalocean", url: "https://digitalocean.com/geo/google.csv", kind: "csv" },
  { name: "linode", url: "https://geoip.linode.com/", kind: "csv" },
  { name: "vultr", url: "https://geofeed.constant.com/", kind: "csv" },
  // Leaseweb publishes no list of its own, but every one of these networks is
  // registered to Leaseweb itself (the holder is checked on each run, so a
  // renumbered or transferred ASN fails the script instead of listing a
  // stranger), and a dedicated-server host has no residential customers.
  // 2026-10-14: a farm signup came from AS7203 (Leaseweb USA, San Jose).
  {
    name: "leaseweb",
    url: "https://stat.ripe.net/data/announced-prefixes/",
    kind: "asn",
    holder: /leaseweb/i,
    asns: [7203, 15003, 16265, 19148, 25847, 27411, 28753, 30633, 59253, 60626, 60781, 133752, 134351, 136988, 202134, 203774, 203928, 205544, 393886, 394380, 395954, 396190, 396362],
  },
]

async function fetchJson(url) {
  return JSON.parse(await fetchText(url))
}

/** Every prefix the networks announce, after checking each is registered to the expected holder. */
async function asnPrefixes(source) {
  const out = []
  for (const asn of source.asns) {
    const overview = await fetchJson(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${asn}`)
    const holder = overview?.data?.holder ?? ""
    if (!source.holder.test(holder)) throw new Error(`${source.name}: AS${asn} is held by "${holder}", not ${source.holder}`)
    const announced = await fetchJson(`${source.url}data.json?resource=AS${asn}`)
    const prefixes = announced?.status === "ok" ? announced?.data?.prefixes : null
    // An answer with no prefixes is a failed read, never "this network is empty":
    // it would silently drop the network from the list.
    if (!Array.isArray(prefixes)) throw new Error(`${source.name}: AS${asn} prefix read failed (status ${announced?.status})`)
    out.push(...prefixes.map((p) => p.prefix))
  }
  return out
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "nodaro-hosting-ranges/1" } })
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.text()
}

/** Every CIDR a source lists, as strings; the parser decides what is valid. */
function extract(kind, text) {
  if (kind === "aws") {
    const j = JSON.parse(text)
    return [...j.prefixes.map((p) => p.ip_prefix), ...j.ipv6_prefixes.map((p) => p.ipv6_prefix)]
  }
  if (kind === "gcp") {
    const j = JSON.parse(text)
    return j.prefixes.map((p) => p.ipv4Prefix ?? p.ipv6Prefix).filter(Boolean)
  }
  if (kind === "oracle") {
    const j = JSON.parse(text)
    return j.regions.flatMap((r) => r.cidrs.map((c) => c.cidr))
  }
  // Geofeed CSV (RFC 8805): "prefix,country,region,city,postal" with # comments.
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(",")[0].trim())
}

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/

function v4ToInt(cidr) {
  const m = V4.exec(cidr)
  if (!m) return null
  const octets = m.slice(1, 5).map(Number)
  const prefix = Number(m[5])
  if (octets.some((o) => o > 255) || prefix > 32) return null
  const bits = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return { start: (bits & mask) >>> 0, prefix }
}

function intToV4(n, prefix) {
  return `${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}/${prefix}`
}

/** Drop every v4 prefix contained in another, then merge exact neighbours. */
function aggregateV4(cidrs) {
  const parsed = [...new Set(cidrs)].map(v4ToInt).filter(Boolean)
  parsed.sort((a, b) => a.start - b.start || a.prefix - b.prefix)
  const kept = []
  for (const p of parsed) {
    const last = kept[kept.length - 1]
    const size = (prefix) => (prefix === 0 ? 2 ** 32 : 2 ** (32 - prefix))
    if (last && p.start >= last.start && p.start + size(p.prefix) <= last.start + size(last.prefix)) continue
    kept.push(p)
  }
  // Merge aligned sibling halves until nothing merges.
  let merged = true
  let list = kept
  while (merged) {
    merged = false
    const next = []
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      const b = list[i + 1]
      const size = a.prefix === 0 ? 2 ** 32 : 2 ** (32 - a.prefix)
      if (b && a.prefix === b.prefix && a.prefix > 0 && b.start === a.start + size && a.start % (size * 2) === 0) {
        next.push({ start: a.start, prefix: a.prefix - 1 })
        i++
        merged = true
      } else {
        next.push(a)
      }
    }
    list = next
  }
  return list.map((p) => intToV4(p.start, p.prefix))
}

/**
 * Never a client: documentation, private, shared-address, loopback, link-local,
 * multicast and reserved space. A geofeed lists some of these (a provider's
 * own private/documentation entries), and a test uses TEST-NET addresses.
 */
const NEVER_HOSTING_V4 = ['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4']
function reserved(cidr) {
  const p = v4ToInt(cidr)
  if (!p) { const l = cidr.toLowerCase(); return l.startsWith('2001:db8:') || /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith('ff') || l.startsWith('::1/') }
  return NEVER_HOSTING_V4.some((n) => { const r = v4ToInt(n); const size = (q) => (q === 0 ? 2 ** 32 : 2 ** (32 - q)); return p.start >= r.start && p.start + size(p.prefix) <= r.start + size(r.prefix) })
}

const all = { v4: [], v6: [], sources: [] }
for (const s of SOURCES) {
  const cidrs = s.kind === "asn" ? await asnPrefixes(s) : extract(s.kind, await fetchText(s.url))
  const v4 = cidrs.filter((c) => V4.test(c) && !reserved(c))
  const v6 = cidrs.filter((c) => c.includes(":") && !reserved(c))
  all.v4.push(...v4)
  all.v6.push(...v6.map((c) => c.toLowerCase()))
  all.sources.push({ name: s.name, url: s.url, v4: v4.length, v6: v6.length })
  console.log(`${s.name}: ${v4.length} v4, ${v6.length} v6`)
}

const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  sources: all.sources,
  v4: aggregateV4(all.v4),
  v6: [...new Set(all.v6)].sort(),
}
writeFileSync(OUT, JSON.stringify(out, null, 0) + "\n")
console.log(`wrote ${OUT}: ${out.v4.length} v4 prefixes (from ${all.v4.length}), ${out.v6.length} v6`)
