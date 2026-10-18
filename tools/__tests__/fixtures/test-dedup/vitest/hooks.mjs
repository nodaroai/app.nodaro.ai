// Subject of the hook-failure probes: the candidates assert f() only in a
// beforeAll / afterAll hook, the keeper never calls f.
export function f(x) {
  return x > 1 ? "big" : "small"
}

export function g(a, b) {
  return a * b
}
