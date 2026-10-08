import { describe, expect, it } from "vitest"
import { assetNamesIn, looksLikeHtml } from "../site-asset-crawl.js"

describe("assetNamesIn", () => {
  it("reads the shell's stylesheet and scripts", () => {
    const html = `<link rel="preload" href="/fonts/geist-latin-wght-normal.woff2" as="font"><script type="module" crossorigin src="/assets/index-CywR7i_a.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/react-vendor-DGo8eoPk.js"><link rel="stylesheet" crossorigin href="/assets/index-Dz56B_55.css">`
    expect(assetNamesIn(html, "page")).toEqual(["index-CywR7i_a.js", "react-vendor-DGo8eoPk.js", "index-Dz56B_55.css"])
  })

  it("reads the stylesheets a script's lazily loaded chunks need", () => {
    const js = `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/editor-A1b2.js","assets/editor-C3d4.css","assets/flow-E5f6.css"])))=>i.map(i=>d[i]);`
    expect(assetNamesIn(js, "script")).toEqual(["editor-A1b2.js", "editor-C3d4.css", "flow-E5f6.css"])
  })

  it("reads a stylesheet's fonts and images, written either way, and nothing outside /assets", () => {
    const css = `@font-face{src:url(/assets/KaTeX_Main-Regular.B22Nviop.woff2) format("woff2"),url("./KaTeX_Main-Regular.Dr94JaBh.woff")}
      .logo{background:url(logo-x9.svg)}.a{background:url(/fonts/geist.woff2)}.b{background:url(data:image/png;base64,AAAA)}`
    expect(assetNamesIn(css, "stylesheet")).toEqual(["KaTeX_Main-Regular.B22Nviop.woff2", "KaTeX_Main-Regular.Dr94JaBh.woff", "logo-x9.svg"])
  })

  it("names each file once", () => {
    expect(assetNamesIn(`/assets/a-1.css /assets/a-1.css assets/a-1.css`, "page")).toEqual(["a-1.css"])
  })
})

describe("looksLikeHtml", () => {
  it("an HTML page in place of a file is refused, by its type or by its first bytes", () => {
    expect(looksLikeHtml("text/html; charset=utf-8", "body{}")).toBe(true)
    expect(looksLikeHtml("text/css", "<!doctype html><html>")).toBe(true)
    expect(looksLikeHtml("text/css; charset=utf-8", "body{color:teal}")).toBe(false)
    expect(looksLikeHtml("font/woff2", "wOF2")).toBe(false)
  })
})
