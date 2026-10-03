// Pure parsing of ffprobe answers — no process, no I/O — so every prober (and
// every test that mocks the probers) shares one reading of them.

/** The first non-empty row of an ffprobe `-of csv` answer. */
export function firstCsvRow(output: string): string {
  return output.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? ""
}

/**
 * The fields of the first non-empty row of an ffprobe `-of csv` answer, with
 * trailing EMPTY fields dropped. A plain `output.trim().split(sep)` misreads
 * two real answer shapes:
 *  - MPEG-TS prints each selected stream TWICE — top-level and again under its
 *    program: `"320x240\n\n320x240"` read as height NaN → the 1080 fallback
 *    (a 320×240 cut rendered on a 320×1080 canvas).
 *  - A stream that carries side data (a rotated phone MP4's display matrix,
 *    MPEG-2's CPB properties — every DVD/VOB program stream) gets an empty
 *    child section appended: `"30000/1001,"` read as 30000 fps → a 60 fps
 *    canvas (twice the frames and the encode for the whole edit).
 */
export function csvFields(output: string, sep = ","): string[] {
  const fields = firstCsvRow(output).split(sep).map((f) => f.trim())
  while (fields.length > 0 && fields[fields.length - 1] === "") fields.pop()
  return fields
}
