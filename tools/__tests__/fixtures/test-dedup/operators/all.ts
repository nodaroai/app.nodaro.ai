// Every construct the mutator rewrites, in TypeScript: the self-test applies
// each of its sites and requires the result to parse.
type Opt = { v?: number[]; w?: Opt }
export enum Mode { A = 1 }
declare const host: { f?: () => number }

export function ops(a: number, b: number, o: Opt | undefined, list: string[]): unknown {
  let n = a + b - a * b / (b % 3 || 1)
  n += 1; n -= 2; n *= 3; n /= 4; n %= 5
  let flag: boolean | undefined
  flag ??= true; flag &&= !flag; flag ||= false
  n++; n--; ++n; --n
  const neg = -a, pos = +b, inv = ~a, not = !flag, pow = (-a) ** 2
  const deep = o?.w?.v?.[0] ?? host.f?.() ?? 0
  ;[a, b] = [b, a]
  ;({ a } = { a: b })
  for (const [k, v] of Object.entries({ x: 1 })) n += Number(k) + v
  for (const key in { y: 2 }) list.push(key)
  const picked = list.filter((s) => s.startsWith("a")).map((s) => s.toUpperCase()).slice(1).some((s) => s.endsWith("z"))
  const lo = Math.min(a, b), hi = Math.max(a, b)
  const obj = { a, b: [a, b], c: { d: `${a}-${b}` }, get e() { return a }, m() { return [] } }
  const arrow = () => ({ k: 1 })
  const same = (x: number) => x satisfies number
  const t = (x: unknown) => x as Opt
  if (a > b && !(b <= a) || a === b) return { n, neg, pos, inv, not, pow, deep, picked, lo, hi, obj, arrow, same, t }
  while (n < 0) n++
  do { n-- } while (n > 10)
  try { JSON.parse("x") } catch { n = 0 } finally { n += 0 }
  return a !== b ? "ne" : flag ? `y${n}` : undefined
}

export class Box<T> {
  #items: T[] = []
  constructor(private readonly cap = 2) {}
  push(x: T): this { if (this.#items.length < this.cap) this.#items.push(x); return this }
  get size() { return this.#items.length }
}

export class Sub extends Box<number> {
  constructor() { super(3) }
}
