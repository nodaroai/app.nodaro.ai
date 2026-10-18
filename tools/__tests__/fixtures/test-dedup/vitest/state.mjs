// Subject of the pre-filter probe: a branch the candidate reaches only after
// its sibling switched the module into strict mode.
let strict = false

export function setStrict(on) {
  strict = on
}

export function label(n) {
  if (strict) return n > 0 ? "pos" : "non-pos"
  return String(n)
}

export const unit = () => "u"
