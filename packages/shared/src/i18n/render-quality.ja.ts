import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Engines — keep brand names in English
  "unreal-engine-5": { description: "リアルタイム・パストレースのUE5ルック" },
  "blender-cycles": { description: "Cycles のアンバイアス・パストレーシング" },
  "octane-render": { description: "GPU スペクトル・パストレーシング" },
  "redshift": { description: "プロダクション GPU バイアスト・レンダラー" },
  "houdini-mantra": { description: "VFX グレードの物理ベース・レンダリング" },
  "arnold-render": { description: "業界標準の VFX パストレーサー" },
  "corona-renderer": { description: "フォトリアルな建築ビジュアライゼーション向けアンバイアス・レンダラー" },
  "vray": { description: "業界標準の製品／建築ビジュアライゼーション／VFX 向けレンダラー" },
  "aces": { description: "シネマグレードの ACES カラーマネジメント" },

  // Render-quality keywords
  "raytracing": { label: "レイトレーシング", description: "正確な反射と影" },
  "physically-based-rendering": { label: "PBR（物理ベース）", description: "物理ベースのマテリアル" },
  "global-illumination": { label: "グローバルイルミネーション", description: "リアルな光のバウンス（間接光）" },
  "lumen-reflections": { label: "Lumen 反射", description: "リアルタイムのダイナミック GI" },

  // Resolution / Detail — keep technical labels
  "8k-uhd": { description: "極めてシャープな8K解像度" },
  "4k-uhd": { description: "鮮明な4K解像度" },
  "16k-megapixel": { description: "信じられないほど高解像度のディテール" },
  "ultra-detailed": { label: "超高精細", description: "最大限のミクロ・ディテール・レンダリング" },

  // Style stamps
  "raw-photo": { label: "RAW 写真", description: "未加工の写真的な質感" },
  "masterpiece": { label: "マスターピース", description: "熟練者の手によるクオリティの証" },
  "award-winning": { label: "受賞作品級", description: "賞レースで評価されるレベルの品質" },

  // Additional render quality
  "volumetric-lighting": { label: "ボリュメトリック・ライティング", description: "大気を貫くゴッドレイのボリュメトリックな光の柱" },
  "photon-mapping": { label: "フォトンマッピング", description: "コースティックを意識したフォトンマップによるグローバルイルミネーション" },
  "ai-upscaled": { label: "AIアップスケール", description: "ニューラルネットワークによるディテール強化アップスケール、シャープな超解像" },
  "denoised": { label: "ノイズ除去", description: "ノイズを除去したクリーンで澄んだレンダリング、粒子や斑点なし" },
}

export default map
