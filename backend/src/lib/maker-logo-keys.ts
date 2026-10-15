import type { ModelMakerId } from "@nodaro/shared/model-catalog"

/**
 * Where a model maker's official mark lives in the deployment's storage: ONE
 * convention under the public media base (`R2_PUBLIC_URL`), one SVG per maker
 * id (`MODEL_MAKERS` in `@nodaro/shared`) — `brand/makers/<makerId>.svg`. The
 * files are the operator's to upload: a company's mark is its trademark, so
 * nothing in this repo ships one (docs/deployment.md, "Model maker marks").
 *
 * No runtime imports: the storage layer's delete paths read the prefix (they
 * keep it, `kept-storage-prefixes.ts`), and the resolver (`maker-logos.ts`)
 * reads the storage layer.
 */
export const MAKER_LOGO_PREFIX = "brand/makers/"

/** The storage key of a maker's mark. */
export function makerLogoObjectKey(id: ModelMakerId): string {
  return `${MAKER_LOGO_PREFIX}${id}.svg`
}
