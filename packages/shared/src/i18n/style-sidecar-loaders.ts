/**
 * Loaders of the `style` catalog's locale sidecars, for a host with no
 * bundler glob of its own (a Node server): the same files a Vite app hands to
 * `registerSidecarLoaders` through `import.meta.glob`, each still its own lazy
 * chunk, so nothing here grows a bundle that does not ask for a locale.
 *
 * ```ts
 * registerSidecarLoaders(STYLE_SIDECAR_LOADERS)
 * await ensureLocaleCatalogLoaded("style", locale)
 * resolveLabel("style", id, englishLabel, locale)
 * ```
 *
 * Keys are the sidecars' file names as `registerSidecarLoaders` matches them
 * (`"./style.<locale>.ts"`), one per non-English language (a test holds this).
 */
import type { SidecarLoader } from "./index.js"

export const STYLE_SIDECAR_LOADERS: Readonly<Record<string, SidecarLoader>> = {
  "./style.ar.ts": () => import("./style.ar.js"),
  "./style.de.ts": () => import("./style.de.js"),
  "./style.es.ts": () => import("./style.es.js"),
  "./style.fr.ts": () => import("./style.fr.js"),
  "./style.he.ts": () => import("./style.he.js"),
  "./style.hi.ts": () => import("./style.hi.js"),
  "./style.ja.ts": () => import("./style.ja.js"),
  "./style.ko.ts": () => import("./style.ko.js"),
  "./style.pt-BR.ts": () => import("./style.pt-BR.js"),
  "./style.ru.ts": () => import("./style.ru.js"),
  "./style.zh-CN.ts": () => import("./style.zh-CN.js"),
}
