/**
 * A MOV that keeps no audio of its own and names another file to read it from:
 * the `moov` of an M4A whose data reference (`dref`) is rewritten from "in this
 * file" to a Mac alias record, and no `mdat`. ffmpeg's mov demuxer follows such
 * a reference only with its `enable_drefs` option on (it is off by default);
 * with it on, the samples are read from the named file at the offsets the
 * `moov` lists — so that file must be the very M4A the `moov` came from.
 *
 * `aliasPath` is the alias's path record, colon-separated with the volume
 * first ("Vol:x:secret:ext.m4a"). ffmpeg resolves it relative to the MOV:
 * `nlvlFrom` - 1 folders up from the MOV's own, then the last `nlvlTo` path
 * parts — so ("Vol:x:secret:ext.m4a", 2, 2) names `../secret/ext.m4a`.
 *
 * The record's layout is the one `mov_read_dref` reads (libavformat/mov.c).
 */

/** The atoms between `start` and `end`: offset, size and type of each. */
function* atoms(buf: Buffer, start: number, end: number): Generator<{ off: number; size: number; type: string }> {
  let i = start
  while (i + 8 <= end) {
    const size = buf.readUInt32BE(i)
    if (size < 8) return
    yield { off: i, size, type: buf.toString("latin1", i + 4, i + 8) }
    i += size
  }
}

function findAtom(buf: Buffer, start: number, end: number, type: string): { off: number; size: number } {
  for (const a of atoms(buf, start, end)) if (a.type === type) return a
  throw new Error(`alias-reference-mov: no ${type} atom`)
}

/** A fixed-width field: a length byte, then `text` padded with zeros to `width` bytes. */
function pascal(text: string, width: number): Buffer {
  const out = Buffer.alloc(1 + width)
  out[0] = text.length
  out.write(text, 1, "latin1")
  return out
}

/** The `alis` data-reference entry for `aliasPath`. */
function aliasEntry(aliasPath: string, nlvlFrom: number, nlvlTo: number): Buffer {
  const parts = aliasPath.split(":")
  const path = Buffer.from(aliasPath, "latin1")
  const levels = Buffer.alloc(4)
  levels.writeUInt16BE(nlvlFrom, 0)
  levels.writeUInt16BE(nlvlTo, 2)
  const pathRecord = Buffer.alloc(4)
  pathRecord.writeInt16BE(2, 0) // type 2: the absolute path
  pathRecord.writeUInt16BE(path.length, 2)
  const end = Buffer.alloc(4)
  end.writeInt16BE(-1, 0) // the end of the records
  const body = Buffer.concat([
    Buffer.alloc(10),
    pascal(parts[0] ?? "", 27), // the volume
    Buffer.alloc(12),
    pascal(parts[parts.length - 1] ?? "", 63), // the file name
    Buffer.alloc(16),
    levels,
    Buffer.alloc(16),
    pathRecord,
    path,
    Buffer.alloc(path.length % 2), // records are padded to an even length
    end,
  ])
  const head = Buffer.alloc(12)
  head.writeUInt32BE(12 + body.length, 0)
  head.write("alis", 4, "latin1")
  head.writeUInt32BE(0, 8) // version and flags: 0, the data is NOT in this file
  return Buffer.concat([head, body])
}

/**
 * `m4a` (an M4A with its index first, `-movflags +faststart`, one track)
 * rewritten as a MOV whose only track reads its samples from `aliasPath`.
 */
export function aliasReferenceMov(m4a: Buffer, aliasPath: string, nlvlFrom: number, nlvlTo: number): Buffer {
  const ftyp = findAtom(m4a, 0, m4a.length, "ftyp")
  const moovAt = findAtom(m4a, 0, m4a.length, "moov")
  const moov = Buffer.from(m4a.subarray(moovAt.off, moovAt.off + moovAt.size))

  // moov > trak > mdia > minf > dinf > dref, each atom's offset within `moov`.
  const chain: Array<{ off: number; size: number }> = []
  let start = 0
  let end = moov.length
  for (const type of ["moov", "trak", "mdia", "minf", "dinf", "dref"]) {
    const a = findAtom(moov, start, end, type)
    chain.push(a)
    start = a.off + 8
    end = a.off + a.size
  }
  const dref = chain[chain.length - 1]!
  // dref: size, type, version and flags, entry count, then the entries.
  const entryAt = dref.off + 16
  const entrySize = moov.readUInt32BE(entryAt)
  if (moov.toString("latin1", entryAt + 4, entryAt + 8) !== "url ") throw new Error("alias-reference-mov: the first data reference is not 'url '")

  const alias = aliasEntry(aliasPath, nlvlFrom, nlvlTo)
  const out = Buffer.concat([moov.subarray(0, entryAt), alias, moov.subarray(entryAt + entrySize)])
  const grew = alias.length - entrySize
  for (const a of chain) out.writeUInt32BE(a.size + grew, a.off)
  return Buffer.concat([m4a.subarray(ftyp.off, ftyp.off + ftyp.size), out])
}
