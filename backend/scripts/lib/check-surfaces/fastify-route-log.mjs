// The `fastify` the app sees while check:surfaces --runtime boots it: the real
// factory, with an onRoute hook on every instance it creates that records each
// route as it is added (the same collector the route-scope tests install with
// a module mock). Loaded only through fastify-route-loader.mjs.
import realFastify from "fastify"

export * from "fastify"

export default function fastifyWithRouteLog(...args) {
  const app = realFastify(...args)
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const method of methods) {
      if (method !== "HEAD") globalThis.__checkSurfacesRoutes?.push({ method, url: route.url })
    }
  })
  return app
}
