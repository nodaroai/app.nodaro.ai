import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Engines — keep brand names in English
  "unreal-engine-5": { description: "リアルタイム・パストレースのUE5ルック" },
  "blender-cycles": { description: "Cycles の不偏パストレーシング" },
  "octane-render": { description: "GPU スペクトル・パストレーシング" },
  "redshift": { description: "プロダクション GPU バイアスト・レンダラー" },
  "houdini-mantra": { description: "VFX グレードの物理ベース・レンダリング" },

  // Render-quality keywords
  "raytracing": { label: "レイトレーシング", description: "正確な反射と影" },
  "physically-based-rendering": { label: "PBR（物理ベース）", description: "物理ベースのマテリアル" },
  "global-illumination": { label: "グローバルイルミネーション", description: "リアルな光の反射" },
  "lumen-reflections": { label: "Lumen 反射", description: "リアルタイムのダイナミック GI" },

  // Resolution / Detail — keep technical labels
  "8k-uhd": { description: "極めてシャープな8K解像度" },
  "4k-uhd": { description: "鮮明な4K解像度" },
  "16k-megapixel": { description: "信じられないほど高解像度のディテール" },
  "ultra-detailed": { label: "超高精細", description: "最大限のミクロ・ディテール・レンダリング" },

  // Style stamps
  "raw-photo": { label: "Raw 写真", description: "未加工の写真的な質感" },
  "masterpiece": { label: "マスターピース", description: "熟練者の手によるクオリティの証" },
  "award-winning": { label: "受賞作品級", description: "受賞回路レベルの品質" },

  // Additional render quality
  "volumetric-lighting": { label: "ボリュメトリック・ライティング", description: "ゴッドレイのボリュメトリックな光の柱" },
  "photon-mapping": { label: "フォトンマッピング", description: "コースティックを意識したフォトンマップによるグローバルイルミネーション" },
  "ai-upscaled": { label: "AIアップスケール", description: "ニューラルネットワークによるディテール強化アップスケール" },
  "denoised": { label: "ノイズ除去", description: "クリーンでノイズを除去した高純度のレンダリング" },
}

export default map
