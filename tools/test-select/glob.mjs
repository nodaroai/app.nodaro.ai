// tools/test-select/glob.mjs
// A minimal glob for repo-relative POSIX paths: `**`, `*`, `?` and `{a,b}`.
// Hand-rolled on purpose — the tools self-test job runs with no npm install,
// so this directory may only use Node built-ins.
const cache = new Map()

const esc = (s) => s.replace(/[.+^$()|[\]\\{}]/g, "\\$&")

export function globToRegExp(glob) {
  return new RegExp(`^${translate(glob, glob)}$`)
}

// Each brace alternative is itself a glob (`{foo*,bar}`, `{*.ts,x}`, nested
// `{b,{c,d}}`), so it goes through the same rules — escaping it as literal text
// turned `foo*` into the regex `o*` and made `{*.ts,x}` throw.
function translate(glob, whole) {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` is zero or more whole directories; a trailing `**` is the rest.
        if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2 } else { re += ".*"; i += 1 }
      } else re += "[^/]*"
    } else if (c === "?") re += "[^/]"
    else if (c === "{") {
      const { end, alternatives } = splitBraces(glob, i, whole)
      re += `(?:${alternatives.map((a) => translate(a, whole)).join("|")})`
      i = end
    } else re += esc(c)
  }
  return re
}

// The MATCHING close brace (depth-counted) and the top-level alternatives.
function splitBraces(glob, open, whole) {
  const alternatives = []
  let depth = 0
  let start = open + 1
  for (let j = open; j < glob.length; j++) {
    if (glob[j] === "{") depth++
    else if (glob[j] === "}") {
      if (--depth === 0) {
        alternatives.push(glob.slice(start, j))
        return { end: j, alternatives }
      }
    } else if (glob[j] === "," && depth === 1) {
      alternatives.push(glob.slice(start, j))
      start = j + 1
    }
  }
  throw new Error(`unclosed { in glob: ${whole}`)
}

export function matchesAny(path, globs) {
  return globs.some((g) => {
    let re = cache.get(g)
    if (!re) { re = globToRegExp(g); cache.set(g, re) }
    return re.test(path)
  })
}
