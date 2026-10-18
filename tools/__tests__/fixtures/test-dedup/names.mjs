// Module state one test leaves for the next (the order probe; its sites are
// sites-names.json).
const names = []

export function add(name) {
  if (name.length > 0) names.push(name)
}

export function list() {
  return [...names]
}
