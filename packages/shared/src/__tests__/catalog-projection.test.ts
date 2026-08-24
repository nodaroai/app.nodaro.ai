import { describe, it, expectTypeOf } from "vitest"
import type { ProjectedCatalog } from "../catalog-projection.js"

describe("ProjectedCatalog wire shape (Apache boundary)", () => {
  it("is tag-free and policy-free (the deferred CatalogPolicy never crosses the wire)", () => {
    // @ts-expect-error — no `tags` field may exist on the projection shape
    const _t: ProjectedCatalog["tags"] = undefined
    // @ts-expect-error — no policy field may exist either
    const _p: ProjectedCatalog["policy"] = undefined
    void _t
    void _p
    expectTypeOf<ProjectedCatalog>().toHaveProperty("catalogId")
  })
})
