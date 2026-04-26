import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "vignette-soft": { label: "ソフト・ヴィネット", description: "穏やかな四隅の暗化" },
  "vignette-heavy": { label: "ヘビー・ヴィネット", description: "劇的な黒い四隅" },
  "dodge-and-burn": { label: "ドッジ＆バーン", description: "彫刻的なハイライト／シャドウ" },
  "film-grain-fine": { label: "細かいフィルム粒子", description: "繊細な35mm風の粒子" },
  "film-grain-heavy": { label: "粗いフィルム粒子", description: "粗いプッシュ処理風の粒子" },
  "halation-glow": { label: "ハレーション・グロー", description: "Cinestill風の赤いハロー・ブルーム" },
  "bloom-glow": { label: "ブルーム・グロー", description: "ロマンチックで夢のようなハイライト・ブルーム" },
  "chromatic-aberration": { label: "色収差", description: "縁の赤／シアンのフリンジ" },
  "light-leak": { label: "ライトリーク", description: "フレームを横切る暖色の光線" },
  "film-burn": { label: "フィルム焼け", description: "ヴィンテージSuper-8の角フレア" },
  "scratched-emulsion": { label: "傷んだエマルション", description: "古びたフィルムの傷とほこり" },
  "color-fringe": { label: "カラーフリンジ", description: "ハイコントラストエッジの繊細なフリンジ" },
  "soft-focus-diffusion": { label: "ソフトフォーカス・ディフュージョン", description: "霞んだ夢のようなハイライト・ブルーム" },
  "contrast-boost": { label: "コントラスト強調", description: "潰したシャドウと押し上げたハイライト" },
}

export default map
