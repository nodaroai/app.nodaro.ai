// backend/src/providers/image/svg-sniff.ts
/**
 * True when a file's first bytes are an SVG document (`<svg`, or an XML /
 * comment preamble followed by `<svg`). 4 KB, not 512 B: a licence comment or a
 * long XML preamble before `<svg` must not hide a vector file. Shared by Image
 * Overlay (which rasterises SVG crisply) and Video Overlay (which refuses it —
 * sharp would rasterise it silently).
 */
export function isSvgBuffer(buf: Buffer): boolean {
  const head = buf.subarray(0, 4096).toString("utf8").trimStart()
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg")) || (head.startsWith("<!--") && head.includes("<svg"))
}
