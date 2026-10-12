// Module resolve hook for check:surfaces --runtime: `import ... from "fastify"`
// anywhere but in the shim itself resolves to fastify-route-log.mjs.
let shim

export function initialize(data) {
  shim = data.shim
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "fastify" && context.parentURL !== shim) return { url: shim, shortCircuit: true }
  return nextResolve(specifier, context)
}
