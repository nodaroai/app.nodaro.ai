// The private marker list as both never-public CLIs read it, and what a
// finding may print beside it: the history gate (tools/check-history-surface.mjs)
// and the tree check (tools/check-public-surface.mjs). A leaf: it imports
// neither, so both can import it.
//
// The list itself is a secret (PRIVATE_LEAK_MARKERS) or an untracked
// .leak-markers file, read by the same rules as scripts/check-private-markers.sh
// so every gate numbers the markers alike. No marker value is ever printed.

import { existsSync, readFileSync, statSync } from "node:fs"

/**
 * What a marker's term is trimmed of: Unicode White_Space (NEL and the no-break
 * spaces included) plus U+FEFF, which String#trim also strips. A byte-order mark
 * tucked inside a marker's edge space (word, U+FEFF, space) must not leave the
 * term dead; one AT the edge is refused before matching (invisibleMarkers).
 */
export const EDGE_SPACE = new RegExp(`^[\\p{White_Space}${String.fromCharCode(0xfeff)}]+|[\\p{White_Space}${String.fromCharCode(0xfeff)}]+$`, "gu")
const SMALL_SIGMA = String.fromCharCode(0x3c3)
const FINAL_SIGMA = String.fromCharCode(0x3c2)

/**
 * Case-folds a marker or a line the same way on both sides: one code point at
 * a time (String#toLowerCase on a whole string lowercases a word-final capital
 * sigma, U+03A3, to the final form U+03C2, so such a line would never contain
 * a marker's plain sigma U+03C3), with the final sigma folded to the plain one,
 * as git grep -i treats them alike.
 * @param {string} s
 */
export function foldCase(s) {
  if (!/[^\x00-\x7f]/.test(s)) return s.toLowerCase()
  return [...s].map((c) => c.toLowerCase()).join("").replaceAll(FINAL_SIGMA, SMALL_SIGMA)
}

/**
 * A marker's term: the folded marker without its edge whitespace, or the whole
 * folded marker when that is all it is (a lone no-break space).
 * @param {string} marker  one entry of parseMarkerList
 */
export function markerTerm(marker) {
  const folded = foldCase(marker)
  return folded.replace(EDGE_SPACE, "") || folded
}

/** The text a finding shows in place of a line that holds a private marker. */
export const WITHHELD = "(line withheld: it holds a private marker)"

/**
 * What a finding may print of `text`, a line that tripped a rule, beside a
 * loaded list's `terms` (markerTerm): the note {@link WITHHELD} when the FULL
 * line holds a marker's term at all (boundary or not, since an in-word
 * occurrence still spells it, and checked before the cut, so no part of one is
 * printed), else the line trimmed and cut to 160 characters. With no list
 * loaded, a CLI prints no line at all: nothing rules a marker out.
 * @param {string} text
 * @param {readonly string[]} terms
 */
export function withheldLine(text, terms) {
  const line = foldCase(text)
  return terms.some((term) => line.includes(term)) ? WITHHELD : text.trim().slice(0, 160)
}

/**
 * The private marker list, read by the same rule as scripts/check-private-markers.sh
 * so both gates read (and number) the same markers: one per line, exactly as
 * written. Whitespace around a marker is kept, never trimmed: the tree gate
 * matches it literally, and the history gate reads it as a word boundary, so
 * " word " is the word on its own, not every word that contains it. Only save artifacts are
 * dropped: a byte-order mark at the start of the list and every carriage return
 * at the end of a line. An empty or whitespace-only line is no marker.
 * @param {string} raw  the newline-separated list
 * @returns {string[]}
 */
export function parseMarkerList(raw) {
  return raw
    .replace(/^﻿/, "")
    .split("\n")
    .map((l) => l.replace(/\r+$/, ""))
    .filter((l) => !/^[ \t\r\v\f]*$/.test(l))
}

/** Both gates refuse a list that is not UTF-8 text with this line (and never print it). */
export const LIST_NOT_TEXT =
  "the private marker list is not UTF-8 text (it holds a NUL byte, or starts with a UTF-16 byte-order mark); save it as UTF-8."
/** Both gates refuse a marker an invisible character makes dead with this line, by number only. */
export const invisibleMarkerMessage = (n) =>
  `private marker #${n} holds an invisible character (a carriage return inside it, or a zero-width character at an edge) and can never match; fix the list.`
const ZERO_WIDTH = [0x200b, 0x2060, 0xfeff].map((c) => String.fromCharCode(c))
const NUL = String.fromCharCode(0)
const REPLACEMENT = String.fromCharCode(0xfffd)

/**
 * The numbers of the markers an invisible character makes dead, as
 * scripts/check-private-markers.sh finds them: a carriage return inside one (a
 * list saved with lone-CR line ends reads as one long marker), or a zero-width
 * space, word joiner or byte-order mark at either edge (a paste from chat).
 * @param {string[]} markers  parseMarkerList's result
 * @returns {number[]}
 */
export function invisibleMarkers(markers) {
  return markers.flatMap((m, i) => {
    const chars = [...m]
    const dead = m.includes("\r") || ZERO_WIDTH.includes(chars[0]) || ZERO_WIDTH.includes(chars[chars.length - 1])
    return dead ? [i + 1] : []
  })
}

/**
 * The marker list from PRIVATE_LEAK_MARKERS, else from .leak-markers, read and
 * refused by the same rules as scripts/check-private-markers.sh: a secret that
 * yields no marker falls back to the file; a file that is there but is not a
 * readable regular file aborts; a list that is not UTF-8 text (a NUL byte, a
 * UTF-16 byte-order mark) aborts; a marker an invisible character makes dead
 * aborts. Neither yielding a marker is "no list". No value is ever printed.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} tool  the CLI an abort is printed as (`[<tool>] ABORT: …`)
 * @returns {string[]}
 */
export function readMarkerList(env, tool) {
  const abort = (why) => {
    console.error(`[${tool}] ABORT: ${why}`)
    process.exit(1)
  }
  const file = ".leak-markers"
  const fromEnv = env.PRIVATE_LEAK_MARKERS ?? ""
  // The environment reaches Node decoded: a UTF-16 byte-order mark (FF FE or
  // FE FF) arrives as two U+FFFD.
  if (fromEnv.includes(NUL) || fromEnv.startsWith(REPLACEMENT.repeat(2))) abort(LIST_NOT_TEXT)
  let markers = parseMarkerList(fromEnv)
  if (markers.length === 0 && existsSync(file)) {
    let bytes
    try {
      // Only a readable regular file is a list: a directory or a FIFO is not.
      if (!statSync(file).isFile()) throw Object.assign(new Error("not a regular file"), { code: "not a regular file" })
      bytes = readFileSync(file)
    } catch (e) {
      abort(`${file} exists but cannot be read (${e.code ?? e.message}).`)
    }
    const bom16 = bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
    if (bom16 || bytes.includes(0)) abort(LIST_NOT_TEXT)
    markers = parseMarkerList(bytes.toString("utf8"))
  }
  const dead = invisibleMarkers(markers)
  for (const n of dead) console.error(`[${tool}] ABORT: ${invisibleMarkerMessage(n)}`)
  if (dead.length > 0) process.exit(1)
  return markers
}

/**
 * Whether a CLI runs in CI (`CI` set, as every CI service sets it, and not
 * `false` or `0`). There, with no marker list loaded, a finding prints no line:
 * nothing rules out that it holds a marker, and a CI log is read by more
 * people than the terminal of whoever ran it. No secret is given to a job that
 * runs a PR's own code, so a PR's CI never has the list.
 * @param {NodeJS.ProcessEnv} env
 */
export function inCi(env) {
  const ci = (env.CI ?? "").trim()
  return ci !== "" && !/^(?:false|0)$/i.test(ci)
}

/**
 * The marker terms a CLI withholds lines by (markerTerm), or null when it
 * prints no line at all: in CI with no list loaded (`inCi`). With no list
 * outside CI, an empty list: every line prints, as it always has.
 * @param {string[]} markers  readMarkerList's result
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[] | null}
 */
export function printableTerms(markers, env) {
  if (markers.length > 0) return markers.map(markerTerm)
  return inCi(env) ? null : []
}

/** Printed once in place of every line in CI with no list loaded: the file and the rule are what a finding shows. */
export const LINES_NOT_SHOWN =
  "(lines not shown in CI: no private marker list is loaded here, so nothing rules out that a line holds one; the file and the rule name each finding, and a local run prints the lines)"
