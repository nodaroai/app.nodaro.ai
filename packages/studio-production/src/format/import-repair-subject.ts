import { CAMERA_MOVEMENT_KEY, liveLookId } from "../look-pickers"

import type { FormatRegistry, RegistryOption, RegistryPicker } from "./registry"
import type { LookMap } from "./schema"
import { warning, type ImportWarning } from "./warnings"

/**
 * Stage 3's LOOK-MAP / SUBJECT id gate and repairs (plan-import-v2 D14/R31a,
 * fix round B14) — split out of `import-repair.ts` pre-emptively: the file sat
 * at 707 lines, under the 800-line house cap, but close enough that the
 * program's later tasks would push it over — the same discipline as the sound
 * half's own split (`import-repair-sound.ts`, R40-1, made after THAT file
 * actually crossed 800). `gateIds` is the shared three-step gate
 * {@link repairLookMap} and {@link repairSubject} both run; `pickerFor` is
 * exported back to `import-repair.ts`, whose `promoteUnanimousFilm` also reads
 * it. Same discipline as the rest of stage 3: catalog-aware, never rejecting,
 * PURE (never mutates its input; every warning is pushed onto the caller's
 * array). Every relocation in this file is a pure move — same warning codes,
 * messages and paths as before.
 */

/** Which keys a look map may carry — the layer decides, not the key (§3, D14). */
type LookLayer = "film" | "scene" | "picks"

export function pickerFor(
  registry: FormatRegistry,
  key: string,
): RegistryPicker | undefined {
  return registry.pickers.find((p) => p.key === key)
}

/**
 * THE SHARED ID GATE (R33) — the three steps {@link repairLookMap} and
 * {@link repairSubject} did identically, in two copies: drop every id the
 * dimension's own catalog does not carry (one `unknown-id` receipt each), warn
 * ONCE when more survive than its cap allows, and keep the first `cap`.
 *
 * What DIFFERS stays at the call sites — the look layer gates and the
 * `liveLookId` migration, and the OUTPUT SHAPE, which each node passes in:
 * a look writes an array for a multi-pick key, a subject field writes the
 * platform's own spelling (a lone id collapses to a bare string).
 *
 * `undefined` when nothing survives, so the caller writes no key at all.
 */
function gateIds(
  ids: ReadonlyArray<string>,
  gate: {
    readonly label: string
    readonly options: ReadonlyArray<RegistryOption>
    readonly cap: number
    readonly at: string
  },
  warnings: ImportWarning[],
  shape: (kept: ReadonlyArray<string>) => string | string[],
): string | string[] | undefined {
  const known = ids.filter((id) => {
    if (gate.options.some((o) => o.id === id)) return true
    warnings.push(
      warning("unknown-id", `"${id}" is not a ${gate.label} option — dropped.`, gate.at),
    )
    return false
  })
  if (known.length === 0) return undefined
  if (known.length > gate.cap) {
    warnings.push(
      warning(
        "cardinality",
        gate.cap === 1
          ? `${gate.label} takes one id here — kept "${known[0]}".`
          : `${gate.label} takes at most ${gate.cap} — kept the first ${gate.cap}.`,
        gate.at,
      ),
    )
  }
  return shape(known.slice(0, gate.cap))
}

/**
 * One look map, repaired: unknown keys and ids drop, legacy ids migrate through
 * `liveLookId` (the load path's own rule), a key outside its layer drops, and
 * arrays are settled onto the key's cardinality — a `picks` key always to ONE
 * id (that is what the fold resolves), a multi-pick key to its cap.
 */
export function repairLookMap(
  raw: LookMap,
  layer: LookLayer,
  registry: FormatRegistry,
  path: string,
  warnings: ImportWarning[],
): LookMap {
  const out: LookMap = {}
  for (const [key, value] of Object.entries(raw)) {
    const at = `${path}.${key}`
    const picker = pickerFor(registry, key)
    if (!picker) {
      warnings.push(
        warning("unknown-key", `"${key}" is not a dimension this studio knows — dropped.`, at),
      )
      continue
    }
    if (layer === "film" && !registry.filmKeys.has(key)) {
      warnings.push(
        warning("layer", `${picker.label} is not a film dimension — use the scene look.`, at),
      )
      continue
    }
    if (layer !== "film" && !picker.usableAsPick) {
      warnings.push(
        warning("layer", `${picker.label} is its own node, not a look pick — dropped.`, at),
      )
      continue
    }
    if (layer === "scene" && key === CAMERA_MOVEMENT_KEY) {
      warnings.push(
        warning("layer", `${picker.label} belongs to the scene's motion, not its look — dropped.`, at),
      )
      continue
    }
    // A shot pick is ONE id per key, even on a multi-pick dimension: the fold
    // resolves a single fragment per key (`beatContent`).
    const cap = layer === "picks" || !picker.multi ? 1 : picker.maxPicks
    const kept = gateIds(
      // Legacy ids migrate BEFORE the gate — the look layer's own rule, which
      // is why this runs here and not inside the shared helper.
      (Array.isArray(value) ? value : [value]).map(liveLookId),
      { label: picker.label, options: picker.options, cap, at },
      warnings,
      // A LOOK map's shape: one id for a single-pick key or a shot pick, the
      // (capped) array otherwise — including a one-element one, which is the
      // shape `readLookMap` and the pickers already hold for a multi key.
      (ids) => (cap === 1 ? ids[0]! : [...ids]),
    )
    if (kept === undefined) continue
    out[key] = kept
  }
  return out
}

/**
 * `frame.subject`'s own map, repaired against `registry.subject` — the SAME
 * discipline as {@link repairLookMap} (R31a: `frame.subject` is a look-map-
 * shaped node, not a fixed-shape one), keyed by DIMENSION FIELD rather than
 * picker key: an unknown field or an option outside its dimension's list
 * drops with a warning, and a value is settled onto the dimension's own
 * cardinality (`multi` + `maxPicks`, never `picks`' blanket single-id rule).
 *
 * A field that settles to exactly ONE surviving id collapses to a bare
 * string, even on a multi dimension — `SubjectFields`/`SubjectSelection`
 * legally hold either shape per field (the platform's own
 * `hairColor?: string | ReadonlyArray<string>`), so a one-element array is
 * never the repaired shape; the Subject builder and the strict schema both
 * already treat the two as interchangeable.
 */
export function repairSubject(
  subject: Record<string, string | string[]>,
  registry: FormatRegistry,
  path: string,
  warnings: ImportWarning[],
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [field, value] of Object.entries(subject)) {
    const at = `${path}.subject.${field}`
    const dim = registry.subject.find((d) => d.field === field)
    if (!dim) {
      warnings.push(
        warning("unknown-key", `"${field}" is not a subject dimension this studio knows — dropped.`, at),
      )
      continue
    }
    const kept = gateIds(
      Array.isArray(value) ? value : [value],
      {
        label: dim.label,
        options: dim.options,
        cap: dim.multi ? dim.maxPicks : 1,
        at,
      },
      warnings,
      // A SUBJECT field's shape is the PLATFORM's (R35): a single surviving id
      // is a bare string even on a multi dimension — exactly what
      // `normalizeSubjectFields` (`@nodaro/prompts`) writes, which is why the
      // exporter's `toSubjectMap` now runs through that helper and converges
      // here without either side re-deriving the rule.
      (ids) => (ids.length === 1 ? ids[0]! : [...ids]),
    )
    if (kept === undefined) continue
    out[field] = kept
  }
  return out
}
