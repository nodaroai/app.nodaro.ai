declare module "*.css"

// Vite-style env access (image-reference-format reads import.meta.env).
// Declared non-optional to match vite/client — every real consumer bundles
// this package with Vite, where env is always defined.
interface ImportMeta {
  readonly env: Record<string, string | undefined>
}
