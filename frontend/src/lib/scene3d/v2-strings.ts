import type { TFunction } from "@/lib/i18n"

/** Shared copy for the scene panel and stateless preview. */
export function scene3DV2Text(t: TFunction) {
  return {
    shots: t("cfgext.scene3dShots"),
    shot: (n: number) => t("cfgext.scene3dShot", { n }),
    entities: t("cfgext.scene3dEntities"),
    entityCount: (count: number) => t("cfgext.scene3dEntityCount", { count }),
    bakedCamera: t("cfgext.scene3dBakedCamera"),
    loadingAssets: t("cfgext.scene3dLoadingAssets"),
    assetsUnavailable: t("cfgext.scene3dAssetsUnavailable"),
    noResolver: t("cfgext.scene3dNoResolver"),
    editNeedsApi: t("cfgext.scene3dEditNeedsApi"),
    glbPlacement: t("cfgext.scene3dGlbPlacement"),
    visible: t("cfgext.scene3dVisible"),
    hidden: t("cfgext.scene3dHidden"),
    overridden: t("cfgext.scene3dOverridden"),
    assetFailed: (reason: string) => t("embed3d.assetFailed", { reason }),
  }
}
