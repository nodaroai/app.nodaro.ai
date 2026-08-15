/** Types for copy-build-assets.mjs — lets the vitest guard import it. */

export interface BuildAsset {
  /** Directory relative to `src/` (and, mirrored, to `dist/`). */
  readonly dir: string
  /** Which file names in that directory ship. */
  readonly match: RegExp
}

export const BUILD_ASSETS: ReadonlyArray<BuildAsset>

export function copyBuildAssets(options: {
  rootDir: string
  assets?: ReadonlyArray<BuildAsset>
}): Promise<Array<{ dir: string; files: string[] }>>
