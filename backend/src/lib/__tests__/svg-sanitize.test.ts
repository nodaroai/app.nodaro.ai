// @test-watches backend/src/lib/__tests__/fixtures/svg/*.svg
import { readFileSync } from "node:fs"
import { JSDOM } from "jsdom"
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import {
  SVG_MAX_BYTES,
  SVG_REFUSED_MESSAGE,
  SvgRefusedError,
  appendSvgWatermark,
  isSvgRefusedError,
  looksLikeSvg,
  repairSvgNamespaces,
  sanitizeSvg,
  svgIntrinsicSize,
} from "../svg-sanitize.js"

// Real GPT Image 2.6 SVG output (KIE), kept as data: name → its pixel size.
const SAMPLES: Record<string, number> = {
  "luna-1k.svg": 1024,
  "sol-1k.svg": 1024,
  "terra-1k.svg": 1024,
  "market-a.svg": 1024,
  "market-b.svg": 1024,
  "market-c.svg": 1024,
  "teapot-2880.svg": 2880,
}
const sample = (name: string) => readFileSync(new URL(`./fixtures/svg/${name}`, import.meta.url), "utf8")

const SVG_NS = "http://www.w3.org/2000/svg"
const XLINK = ' xmlns:xlink="http://www.w3.org/1999/xlink"'
const { window } = new JSDOM("")

function parse(svg: string): Document {
  const doc = new window.DOMParser().parseFromString(svg, "image/svg+xml")
  expect(doc.getElementsByTagNameNS("*", "parsererror")).toHaveLength(0)
  return doc
}

const elements = (doc: Document) => Array.from(doc.getElementsByTagNameNS("*", "*"))

function tally(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of keys) out[key] = (out[key] ?? 0) + 1
  return out
}

const elementCounts = (doc: Document) => tally(elements(doc).map((el) => el.localName))
const attributePairs = (doc: Document) =>
  tally(elements(doc).flatMap((el) => Array.from(el.attributes).map((a) => `${el.localName}@${a.name}`)))

async function raster(svg: string) {
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  const meta = await sharp(png).metadata()
  const raw = await sharp(Buffer.from(svg)).raw().toBuffer()
  return { width: meta.width, height: meta.height, raw }
}

/** A test document: a harmless sibling `#keep` beside the markup under test. */
const doc = (inner: string, rootAttrs = "") =>
  `<svg xmlns="${SVG_NS}"${rootAttrs} viewBox="0 0 100 100" width="100" height="100">` +
  `<rect id="keep" width="10" height="10" fill="red"/>${inner}</svg>`

async function clean(inner: string, rootAttrs = "") {
  const out = await sanitizeSvg(doc(inner, rootAttrs))
  const parsed = parse(out)
  expect(parsed.getElementById("keep")).not.toBeNull()
  return { out, parsed, has: (id: string) => parsed.getElementById(id) !== null }
}

async function refusal(input: Buffer | string): Promise<SvgRefusedError> {
  try {
    await sanitizeSvg(input)
  } catch (err) {
    expect(err).toBeInstanceOf(SvgRefusedError)
    expect(isSvgRefusedError(err)).toBe(true)
    expect((err as Error).message).toBe(SVG_REFUSED_MESSAGE)
    return err as SvgRefusedError
  }
  throw new Error("the SVG was not refused")
}

describe("sanitizeSvg on the real samples", () => {
  for (const [name, size] of Object.entries(SAMPLES)) {
    it(`${name}: same elements, attributes, size and pixels; idempotent`, async () => {
      const input = sample(name)
      const out = await sanitizeSvg(input)
      const before = parse(input)
      const after = parse(out)
      expect(after.documentElement.localName).toBe("svg")
      expect(after.documentElement.namespaceURI).toBe(SVG_NS)
      expect(out.startsWith("<svg")).toBe(true)
      expect(out).toContain(`xmlns="${SVG_NS}"`)
      expect(out).not.toContain("xmlns:xlink")
      expect(elementCounts(after)).toEqual(elementCounts(before))
      expect(attributePairs(after)).toEqual(attributePairs(before))
      expect(svgIntrinsicSize(out)).toEqual({ width: size, height: size })
      expect(svgIntrinsicSize(input)).toEqual({ width: size, height: size })
      const [original, sanitized] = await Promise.all([raster(input), raster(out)])
      expect({ width: sanitized.width, height: sanitized.height }).toEqual({ width: size, height: size })
      expect({ width: original.width, height: original.height }).toEqual({ width: size, height: size })
      expect(sanitized.raw.equals(original.raw)).toBe(true)
      expect(await sanitizeSvg(out)).toBe(out)
    }, 30_000)
  }

  it("keeps an id that names a document property (id=\"body\" in two samples)", async () => {
    for (const name of ["luna-1k.svg", "teapot-2880.svg"]) {
      expect(parse(await sanitizeSvg(sample(name))).getElementById("body")).not.toBeNull()
    }
  })

  it("stays linear on a large document (16 000 shapes, about 1 MB: under a second here, minutes when quadratic)", async () => {
    const shapes = Array.from({ length: 16_000 }, (_, i) => `<rect x="${i % 1000}" y="${i % 700}" width="3" height="3"/>`)
    const started = Date.now()
    const out = await sanitizeSvg(doc(shapes.join("")))
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(parse(out).getElementsByTagNameNS(SVG_NS, "rect")).toHaveLength(16_001)
  }, 30_000)

  it("takes a Buffer as well as a string", async () => {
    const input = sample("sol-1k.svg")
    expect(await sanitizeSvg(Buffer.from(input))).toBe(await sanitizeSvg(input))
  })
})

describe("sanitizeSvg removes what is dangerous and keeps its sibling", () => {
  it("<script>", async () => {
    const { out, parsed } = await clean(`<script>alert(1)</script><script xlink:href="https://evil/x.js"/>`, XLINK)
    expect(parsed.getElementsByTagNameNS("*", "script")).toHaveLength(0)
    expect(out).not.toMatch(/alert|evil/)
  })

  it("on* attributes in any case, on the root too", async () => {
    const { out, has } = await clean(
      `<circle id="c" r="5" onload="a()" onclick="b()" ONMOUSEOVER="c()"/>`,
      ` onload="d()"`,
    )
    expect(has("c")).toBe(true)
    expect(out).not.toMatch(/\son\w+=/i)
  })

  it("<foreignObject> with an <iframe> inside", async () => {
    const { out, parsed } = await clean(
      `<foreignObject width="10" height="10"><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://evil/f"/></foreignObject>`,
    )
    expect(parsed.getElementsByTagNameNS("*", "foreignObject")).toHaveLength(0)
    expect(out).not.toMatch(/iframe|evil/)
  })

  it("<iframe>, <embed> and <object> at the top level, with what they hold", async () => {
    const { out, has } = await clean(
      `<iframe src="https://evil/a"/><embed src="https://evil/b"/><object data="https://evil/c"><rect id="inside"/></object>`,
    )
    expect(out).not.toMatch(/iframe|embed|object|evil/)
    expect(has("inside")).toBe(false)
  })

  it("<a>: the link goes, its drawing stays and is cleaned too", async () => {
    const { out, parsed, has } = await clean(
      `<a href="javascript:alert(1)"><rect id="inner" width="5" height="5" onclick="x()"/><script>1</script></a>` +
        `<a xlink:href="https://evil"><circle id="inner2" r="2"/></a>`,
      XLINK,
    )
    expect(parsed.getElementsByTagNameNS("*", "a")).toHaveLength(0)
    expect(has("inner")).toBe(true)
    expect(has("inner2")).toBe(true)
    expect(parsed.getElementById("inner")?.hasAttribute("onclick")).toBe(false)
    expect(parsed.getElementsByTagNameNS("*", "script")).toHaveLength(0)
    expect(out).not.toMatch(/javascript|evil/)
  })

  it("<image>: only an inline png/jpeg/webp survives", async () => {
    const { out, has, parsed } = await clean(
      `<image id="i1" href="javascript:alert(1)"/>` +
        `<image id="i2" href="https://evil/x.png"/>` +
        `<image id="i3" href="data:image/svg+xml;base64,PHN2Zy8+"/>` +
        `<image id="i4" HREF="javascript:alert(2)"/>` +
        `<image id="i5" href="//evil/y.png"/>` +
        `<image id="ok" xlink:href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>`,
      XLINK,
    )
    for (const id of ["i1", "i2", "i3", "i4", "i5"]) expect(has(id)).toBe(false)
    expect(parsed.getElementById("ok")?.getAttribute("xlink:href")).toBe("data:image/png;base64,iVBORw0KGgo=")
    expect(out).not.toMatch(/javascript|evil|svg\+xml/)
  })

  it("<use>: an external or data reference removes the element, #id stays", async () => {
    const { has, out } = await clean(
      `<use id="u1" href="https://evil/s.svg#a"/><use id="u2" href="#keep"/>` +
        `<use id="u3" xlink:href="data:image/svg+xml,%3Csvg%2F%3E"/><use id="u4"/>`,
      XLINK,
    )
    expect(has("u1")).toBe(false)
    expect(has("u2")).toBe(true)
    expect(has("u3")).toBe(false)
    expect(has("u4")).toBe(false)
    expect(out).not.toMatch(/evil|data:/)
  })

  it("<textPath> and <feImage> keep only an internal reference", async () => {
    const { has } = await clean(
      `<path id="p" d="M0 0 L10 10"/><text><textPath id="tp1" href="#p">ok</textPath>` +
        `<textPath id="tp2" href="https://evil/p">no</textPath></text>` +
        `<filter id="f"><feImage id="fi1" href="https://evil/x.png"/><feImage id="fi2" href="#keep"/></filter>`,
    )
    expect(has("tp1")).toBe(true)
    expect(has("tp2")).toBe(false)
    expect(has("fi1")).toBe(false)
    expect(has("fi2")).toBe(true)
  })

  it("<style>: @import, an external url(), an escape or expression() removes it; url(#id) stays", async () => {
    const styles = async (css: string) =>
      (await clean(`<style>${css}</style>`)).parsed.getElementsByTagNameNS(SVG_NS, "style").length
    expect(await styles("@import url(https://evil/x.css);")).toBe(0)
    expect(await styles(`@import "x.css";`)).toBe(0)
    expect(await styles(".a{fill:url(https://evil/p.svg#g)}")).toBe(0)
    expect(await styles(".a{fill:u\\72l(https://evil/p)}")).toBe(0)
    expect(await styles(".a{width:expression(alert(1))}")).toBe(0)
    expect(await styles(".a{background:image-set('https://evil/x.png' 1x)}")).toBe(0)
    expect(await styles(".a{fill:url(#g)} .b{stroke:url( '#g' )}")).toBe(1)
  })

  it("<style> in CDATA keeps its rules (and is checked the same)", async () => {
    const kept = await clean(`<style><![CDATA[.b > .c{fill:url('#g')}]]></style>`)
    expect(kept.parsed.getElementsByTagNameNS(SVG_NS, "style")[0]?.textContent).toBe(".b > .c{fill:url('#g')}")
    const removed = await clean(`<style><![CDATA[@import "https://evil/x.css";]]></style>`)
    expect(removed.parsed.getElementsByTagNameNS(SVG_NS, "style")).toHaveLength(0)
  })

  it("presentation and style attributes that load something are dropped, url(#id) is kept", async () => {
    const { parsed, out } = await clean(
      `<rect id="r1" fill="url(https://evil#g)"/><rect id="r2" fill="url(#g)"/>` +
        `<rect id="r3" style="background:url(javascript:alert(1))"/><rect id="r4" style="fill:url(#g);stroke:blue"/>` +
        `<rect id="r5" filter="url( 'https://evil/f' )"/><rect id="r6" style="width:expression(alert(1))"/>` +
        `<rect id="r7" mask="URL(//evil/m)"/><rect id="r8" clip-path="url(#c)" marker-end="url(https://evil/m)"/>`,
    )
    const attr = (id: string, name: string) => parsed.getElementById(id)?.getAttribute(name) ?? null
    expect(attr("r1", "fill")).toBeNull()
    expect(attr("r2", "fill")).toBe("url(#g)")
    expect(attr("r3", "style")).toBeNull()
    expect(attr("r4", "style")).toBe("fill:url(#g);stroke:blue")
    expect(attr("r5", "filter")).toBeNull()
    expect(attr("r6", "style")).toBeNull()
    expect(attr("r7", "mask")).toBeNull()
    expect(attr("r8", "clip-path")).toBe("url(#c)")
    expect(attr("r8", "marker-end")).toBeNull()
    expect(out).not.toMatch(/evil|javascript|expression/i)
  })

  it("<animate> and <set> go; an <animateTransform> stays unless it targets an href", async () => {
    const { has, out } = await clean(
      `<animate id="an1" attributeName="href" to="javascript:alert(1)"/>` +
        `<set id="s1" attributeName="xlink:href" to="javascript:alert(2)"/>` +
        `<animate id="an2" attributeName="opacity" from="0" to="1" dur="1s"/>` +
        `<animateTransform id="at1" attributeName="transform" type="rotate" from="0" to="90" dur="1s"/>` +
        `<animateTransform id="at2" attributeName="HREF" to="javascript:alert(3)"/>`,
    )
    for (const id of ["an1", "s1", "an2", "at2"]) expect(has(id)).toBe(false)
    expect(has("at1")).toBe(true)
    expect(out).not.toContain("javascript")
  })

  it("drops comments and processing instructions, and everything outside the root", async () => {
    const input = `<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet href="https://evil/x.css"?>` +
      `<!-- before -->${doc(`<!-- <script>x</script> --><?evil data?>`)}<!-- after -->`
    const out = await sanitizeSvg(input)
    expect(out).not.toMatch(/xml-stylesheet|evil|<!--|<\?/)
    expect(parse(out).getElementById("keep")).not.toBeNull()
  })

  it("declares xmlns:xlink only while an xlink: attribute is left", async () => {
    expect((await clean(`<use xlink:href="#keep"/>`, XLINK)).out).toContain(`xmlns:xlink="http://www.w3.org/1999/xlink"`)
    expect((await clean(`<circle r="1"/>`, XLINK)).out).not.toContain("xmlns:xlink")
  })
})

describe("sanitizeSvg repairs a missing namespace declaration, then cleans as always", () => {
  it("a root with no xmlns is given the SVG namespace, and is cleaned like any other", async () => {
    const out = await sanitizeSvg(`<svg viewBox="0 0 10 10" width="10" height="10"><script>alert(1)</script><rect id="keep" width="10" height="10" onclick="x()"/></svg>`)
    const parsed = parse(out)
    expect(parsed.documentElement.namespaceURI).toBe(SVG_NS)
    expect(out.startsWith(`<svg xmlns="${SVG_NS}"`)).toBe(true)
    expect(out).not.toContain("<script")
    expect(out).not.toContain("onclick")
    expect(parsed.getElementById("keep")).not.toBeNull()
    expect((await raster(out)).width).toBe(10)
  })

  it("an undeclared xlink: is declared, and an external link it carries is still removed", async () => {
    const out = await sanitizeSvg(
      `<svg viewBox="0 0 10 10"><defs><rect id="shape" width="2" height="2"/></defs>` +
      `<image id="evil" xlink:href="https://evil.example/x.png" width="5" height="5"/>` +
      `<a xlink:href="javascript:alert(1)"><circle id="kept" r="2"/></a>` +
      `<use id="inside" xlink:href="#shape"/></svg>`,
    )
    const parsed = parse(out)
    expect(parsed.getElementById("evil")).toBeNull()
    expect(out).not.toContain("evil.example")
    expect(out).not.toContain("javascript:")
    expect(parsed.getElementById("kept")).not.toBeNull()
    expect(parsed.getElementById("inside")?.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#shape")
    expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"')
  })

  it("the repair is only the two declarations: a malformed file, another namespace or a prefixed root is still refused", async () => {
    expect((await refusal(`<svg><rect></svg>`)).reason).toBe("not-well-formed")
    expect((await refusal(`<svg xlink:href="#a"><rect width="1" height="1"></svg>`)).reason).toBe("not-well-formed")
    expect((await refusal(`<svg xmlns="http://www.w3.org/1999/xhtml"><rect/></svg>`)).reason).toBe("not-svg-root")
    expect((await refusal(`<svg:svg><svg:rect width="1" height="1"/></svg:svg>`)).reason).toBe("not-well-formed")
  })

  it("leaves a document that declares both as it is", () => {
    const text = `<svg xmlns="${SVG_NS}"${XLINK} viewBox="0 0 1 1"><use xlink:href="#a"/></svg>`
    expect(repairSvgNamespaces(text)).toBe(text)
    const noXlink = `<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>`
    expect(repairSvgNamespaces(noXlink)).toBe(`<svg xmlns="${SVG_NS}" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>`)
  })
})

describe("sanitizeSvg refuses what it cannot make safe", () => {
  it("a DOCTYPE or an ENTITY, anywhere", async () => {
    expect((await refusal(`<!DOCTYPE svg [<!ENTITY x "y">]>${doc("<text>&x;</text>")}`)).reason).toBe("doctype")
    expect((await refusal(`<!doctype svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">${doc("")}`)).reason).toBe("doctype")
    expect((await refusal(doc(`<!-- <!ENTITY x "y"> -->`))).reason).toBe("doctype")
  })

  it("XML that is not well-formed", async () => {
    expect((await refusal(`<svg xmlns="${SVG_NS}"><rect></svg>`)).reason).toBe("not-well-formed")
    expect((await refusal(`${doc("")}trailing`)).reason).toBe("not-well-formed")
    // An undeclared prefix other than xlink: is not repaired.
    expect((await refusal(`<svg xmlns="${SVG_NS}"><rect inkscape:label="a" width="1" height="1"/></svg>`)).reason).toBe("not-well-formed")
  })

  it("a root that is not <svg> in the SVG namespace (XHTML, a prefix, <html>)", async () => {
    expect((await refusal(`<svg xmlns="http://www.w3.org/1999/xhtml"><rect/></svg>`)).reason).toBe("not-svg-root")
    expect((await refusal(`<s:svg xmlns:s="${SVG_NS}"><s:rect width="1" height="1"/></s:svg>`)).reason).toBe("not-svg-root")
    expect((await refusal(`<html><body>${doc("")}</body></html>`)).reason).toBe("not-svg-root")
    await refusal(`<!doctype html><html><body>${doc("")}</body></html>`)
  })

  it("empty, whitespace, invalid UTF-8, or over the size limit", async () => {
    expect((await refusal("")).reason).toBe("empty")
    expect((await refusal(" \n\t")).reason).toBe("empty")
    expect((await refusal(Buffer.from([0x3c, 0x73, 0x76, 0x67, 0xff, 0xfe]))).reason).toBe("not-utf8")
    const big = doc(`<!-- ${"x".repeat(SVG_MAX_BYTES)} -->`)
    expect((await refusal(big)).reason).toBe("too-large")
    expect((await refusal(Buffer.from(big))).reason).toBe("too-large")
  })

  it("elements nested deeper than 256, before parsing (so even 5 MB of nesting is refused at once)", async () => {
    const nested = (depth: number) => doc(`${"<g>".repeat(depth)}<rect width="1" height="1"/>${"</g>".repeat(depth)}`)
    expect(parse(await sanitizeSvg(nested(250))).getElementsByTagNameNS(SVG_NS, "g")).toHaveLength(250)
    expect((await refusal(nested(300))).reason).toBe("too-deep")
    const started = Date.now()
    expect((await refusal(nested(700_000))).reason).toBe("too-deep")
    expect(Date.now() - started).toBeLessThan(2_000)
    // Markup-like text in a comment, CDATA or an attribute value is not nesting.
    const fake = "<g>".repeat(300)
    await sanitizeSvg(doc(`<!-- ${fake} --><style><![CDATA[/* ${fake} */]]></style><rect title="a>b" width="1"/>`))
  })

  it("nothing drawable left after sanitizing", async () => {
    const refused = await refusal(`<svg xmlns="${SVG_NS}"><script>alert(1)</script><title>t</title></svg>`)
    expect(refused.reason).toBe("nothing-drawable")
  })

  it("SvgRefusedError is a plain Error subclass with the stable message and marker", () => {
    const err = new SvgRefusedError("empty")
    expect(Object.getPrototypeOf(SvgRefusedError.prototype)).toBe(Error.prototype)
    expect(err.message).toBe(SVG_REFUSED_MESSAGE)
    expect(err.svgRefused).toBe(true)
    expect(isSvgRefusedError(err)).toBe(true)
    expect(isSvgRefusedError(Object.assign(new Error("other realm"), { svgRefused: true }))).toBe(true)
    expect(isSvgRefusedError(new Error(SVG_REFUSED_MESSAGE))).toBe(false)
    expect(isSvgRefusedError(null)).toBe(false)
  })
})

describe("looksLikeSvg", () => {
  it("is true for every sample, as a string and as bytes", () => {
    for (const name of Object.keys(SAMPLES)) {
      expect(looksLikeSvg(sample(name))).toBe(true)
      expect(looksLikeSvg(readFileSync(new URL(`./fixtures/svg/${name}`, import.meta.url)))).toBe(true)
    }
  })

  it("skips a BOM, an XML declaration, comments, whitespace and a DOCTYPE", () => {
    const prolog = `${String.fromCharCode(0xfeff)}<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by a model -->\n  `
    expect(looksLikeSvg(Buffer.from(`${prolog}<svg xmlns="${SVG_NS}"/>`))).toBe(true)
    expect(looksLikeSvg(`${prolog}<!DOCTYPE svg [<!ENTITY a "b">]><svg>`)).toBe(true)
    expect(looksLikeSvg(`<svg:svg xmlns:svg="${SVG_NS}">`)).toBe(true)
  })

  it("is false for rasters, HTML and anything else", () => {
    expect(looksLikeSvg(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]))).toBe(false)
    expect(looksLikeSvg(Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"))).toBe(false)
    expect(looksLikeSvg(`<!doctype html><html><body><svg xmlns="${SVG_NS}"/></body></html>`)).toBe(false)
    expect(looksLikeSvg(`<html><svg/></html>`)).toBe(false)
    expect(looksLikeSvg(`<svgx/>`)).toBe(false)
    expect(looksLikeSvg(`<!-- never closed <svg>`)).toBe(false)
    expect(looksLikeSvg("")).toBe(false)
    expect(looksLikeSvg(Buffer.alloc(0))).toBe(false)
  })
})

describe("svgIntrinsicSize", () => {
  const root = (attrs: string) => `<svg xmlns="${SVG_NS}" ${attrs}><rect/></svg>`

  it("reads numeric width and height (unitless or px)", () => {
    expect(svgIntrinsicSize(root(`width="800" height="600"`))).toEqual({ width: 800, height: 600 })
    expect(svgIntrinsicSize(root(`width="512px" height=' 256px '`))).toEqual({ width: 512, height: 256 })
    expect(svgIntrinsicSize(root(`width="100.6" height="0.2"`))).toEqual({ width: 101, height: 1 })
  })

  it("falls back to the viewBox when width/height are not px (%, em) or missing", () => {
    expect(svgIntrinsicSize(root(`width="100%" height="100%" viewBox="0 0 640 480"`))).toEqual({ width: 640, height: 480 })
    expect(svgIntrinsicSize(root(`width="10em" viewBox="0,0,300,150"`))).toEqual({ width: 300, height: 150 })
    expect(svgIntrinsicSize(root(`viewBox="-10 -10 1024 768"`))).toEqual({ width: 1024, height: 768 })
  })

  it("takes the other side from the viewBox's shape when only one is given", () => {
    expect(svgIntrinsicSize(root(`width="512" viewBox="0 0 1024 512"`))).toEqual({ width: 512, height: 256 })
    expect(svgIntrinsicSize(root(`height="100" viewBox="0 0 300 150"`))).toEqual({ width: 200, height: 100 })
  })

  it("is undefined when nothing is usable", () => {
    expect(svgIntrinsicSize(root(""))).toBeUndefined()
    expect(svgIntrinsicSize(root(`width="0" height="10"`))).toBeUndefined()
    expect(svgIntrinsicSize(root(`width="-5" height="10" viewBox="0 0 0 10"`))).toBeUndefined()
    expect(svgIntrinsicSize(root(`width="5mm" height="5mm"`))).toBeUndefined()
    expect(svgIntrinsicSize("<html/>")).toBeUndefined()
  })

  it("reads the root itself: not stroke-width, not a <svg> inside a leading comment", () => {
    const text = `<!-- <svg width="9" height="9"> --><svg xmlns="${SVG_NS}" stroke-width="3" viewBox="0 0 40 20"/>`
    expect(svgIntrinsicSize(text)).toEqual({ width: 40, height: 20 })
  })
})

describe("appendSvgWatermark", () => {
  const texts = (d: Document) => d.getElementsByTagNameNS(SVG_NS, "text")

  it("adds one escaped <text> as the root's last child, inside the viewBox; the sample still rasterises", async () => {
    const out = await sanitizeSvg(sample("terra-1k.svg"))
    const marked = appendSvgWatermark(out, `Nodaro <free> & "trial"`)
    const before = parse(out)
    const after = parse(marked)
    expect(texts(after)).toHaveLength(texts(before).length + 1)
    const mark = after.documentElement.lastElementChild as Element
    expect(mark.localName).toBe("text")
    expect(mark.textContent).toBe(`Nodaro <free> & "trial"`)
    expect(marked).toContain("Nodaro &lt;free&gt; &amp;")
    const x = Number(mark.getAttribute("x"))
    const y = Number(mark.getAttribute("y"))
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThanOrEqual(1024)
    expect(y).toBeGreaterThan(0)
    expect(y).toBeLessThanOrEqual(1024)
    expect(Number(mark.getAttribute("font-size"))).toBeCloseTo(25.6, 5)
    expect(mark.getAttribute("fill")).toBe("#ffffff")
    const { width, height } = await raster(marked)
    expect({ width, height }).toEqual({ width: 1024, height: 1024 })
    // The watermarked file is itself clean: it passes the sanitizer unchanged.
    expect(await sanitizeSvg(marked)).toBe(marked)
  })

  it("is white with a dark outline drawn under it, and the PNG still shows both on a light and a dark drawing", async () => {
    const page = (color: string) => `<svg xmlns="${SVG_NS}" viewBox="0 0 400 400" width="400" height="400"><rect width="400" height="400" fill="${color}"/></svg>`
    const marked = appendSvgWatermark(page("#ffffff"), "Nodaro.ai")
    const mark = parse(marked).documentElement.lastElementChild as Element
    expect(mark.getAttribute("fill")).toBe("#ffffff")
    expect(mark.getAttribute("stroke")).toBe("#000000")
    expect(mark.getAttribute("paint-order")).toBe("stroke")
    expect(Number(mark.getAttribute("stroke-width"))).toBeGreaterThan(0)
    expect(mark.getAttribute("style")).toContain("paint-order:stroke!important")
    // The mark's corner of the still: the outline darkens a white page, the fill lightens a black one.
    const corner = async (svg: string) => {
      const { data, info } = await sharp(Buffer.from(svg)).extract({ left: 260, top: 360, width: 140, height: 40 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      const luma: number[] = []
      for (let i = 0; i < data.length; i += info.channels) luma.push((data[i]! + data[i + 1]! + data[i + 2]!) / 3)
      return { darkest: Math.min(...luma), lightest: Math.max(...luma) }
    }
    expect((await corner(page("#ffffff"))).darkest).toBe(255)
    expect((await corner(marked)).darkest).toBeLessThan(160)
    expect((await corner(page("#000000"))).lightest).toBe(0)
    expect((await corner(appendSvgWatermark(page("#000000"), "Nodaro.ai"))).lightest).toBeGreaterThan(160)
  })

  it("follows a viewBox's offset", () => {
    const marked = appendSvgWatermark(`<svg xmlns="${SVG_NS}" viewBox="-500 -100 200 100"><rect/></svg>`, "x")
    const mark = parse(marked).documentElement.lastElementChild as Element
    const x = Number(mark.getAttribute("x"))
    const y = Number(mark.getAttribute("y"))
    expect(x).toBeGreaterThan(-500)
    expect(x).toBeLessThanOrEqual(-300)
    expect(y).toBeGreaterThan(-100)
    expect(y).toBeLessThanOrEqual(0)
    expect(Number(mark.getAttribute("font-size"))).toBeCloseTo(5, 5)
  })

  it("uses width/height without a viewBox, and 1024×1024 without either", () => {
    const sized = parse(appendSvgWatermark(`<svg xmlns="${SVG_NS}" width="400" height="200"><rect/></svg>`, "x"))
    expect(Number(sized.documentElement.lastElementChild?.getAttribute("font-size"))).toBeCloseTo(10, 5)
    const bare = parse(appendSvgWatermark(`<svg xmlns="${SVG_NS}"><rect/></svg>`, "x"))
    expect(Number(bare.documentElement.lastElementChild?.getAttribute("font-size"))).toBeCloseTo(25.6, 5)
  })

  it("opens a self-closed root and strips characters XML cannot hold", () => {
    const marked = appendSvgWatermark(`<svg xmlns="${SVG_NS}" width="10" height="10"/>`, "a\u0000b\uD800c")
    const after = parse(marked)
    expect(after.documentElement.lastElementChild?.textContent).toBe("abc")
    expect(marked.endsWith("</svg>")).toBe(true)
  })

  it("refuses text that has no root <svg>", () => {
    expect(() => appendSvgWatermark("<html/>", "x")).toThrow(SvgRefusedError)
  })
})
