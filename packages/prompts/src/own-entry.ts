/**
 * A registry keyed by node type is a plain object, and the key is
 * caller-supplied (`?nodeType=` on a public route, a preset row's `node_type`,
 * workflow JSON). A plain `record[key] ?? fallback` reads an Object.prototype
 * member for `"constructor"`, `"toString"` or `"__proto__"` — a function or
 * the prototype itself, which the caller then maps or iterates and throws on.
 * This reads an OWN entry only, so such a name is "no such type".
 */
export function ownEntry<T>(record: Readonly<Record<string, T>>, key: string | undefined): T | undefined {
  return key !== undefined && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
}
