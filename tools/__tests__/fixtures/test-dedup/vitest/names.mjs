// Subject of the order probe: module state one test leaves for the next.
const names = []

export function add(name) {
  if (name.length > 0) names.push(name)
}

export function list() {
  return [...names]
}
