import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Solid / Seamless
  "white-seamless": { label: "ホワイト・シームレス", description: "清潔な白いスタジオペーパー" },
  "black-seamless": { label: "ブラック・シームレス", description: "純粋な黒いスタジオ背景" },
  "grey-seamless": { label: "グレー・シームレス", description: "ニュートラルな中間グレーのスタジオペーパー" },
  "ivory-seamless": { label: "アイボリー・シームレス", description: "暖かなアイボリー色のオフホワイト背景" },
  "deep-red": { label: "ディープレッド", description: "彩度の高い深紅の壁" },
  "royal-blue": { label: "ロイヤルブルー", description: "彩度の高いロイヤルブルーの背景" },
  "emerald-green": { label: "エメラルドグリーン", description: "彩度の高いエメラルド色の壁" },
  "dusty-pink": { label: "ダスティピンク", description: "柔らかく落ち着いたピンクの背景" },
  "mustard-yellow": { label: "マスタードイエロー", description: "暖かなマスタード色の背景" },
  "teal-textured-wall": { label: "ティールのテクスチャ壁", description: "塗られたティール色のテクスチャのある壁" },

  // Gradient
  "red-orange-gradient": { label: "赤からオレンジのグラデーション", description: "暖かい赤からオレンジへのスイープ" },
  "pink-orange-gradient": { label: "ピンクからオレンジのグラデーション", description: "夕焼けのようなピンクからオレンジへのスイープ" },
  "blue-emerald-gradient": { label: "青からエメラルドのグラデーション", description: "クールな青からエメラルドへのスイープ" },
  "sunset-gradient": { label: "サンセット・グラデーション", description: "多色トーンの夕焼けスイープ" },
  "two-tone-split": { label: "ツートーン分割", description: "半分ずつに色分けされた壁" },

  // Textured
  "brick-wall": { label: "レンガの壁", description: "むき出しの赤いレンガの壁" },
  "concrete-wall": { label: "コンクリートの壁", description: "生のコンクリートの表面" },
  "plastered-wall": { label: "漆喰の壁", description: "手鏝塗りの漆喰" },
  "peeling-paint": { label: "剥がれた塗装", description: "塗装が剥がれたヴィンテージの壁" },
  "wood-paneling": { label: "木目パネル", description: "暖かな木目パネル張りの壁" },

  // Fabric
  "muslin-drape": { label: "モスリン", description: "斑模様の手描きモスリン" },
  "velvet-drape": { label: "ベルベットドレープ", description: "重厚なベルベットのドレープ背景" },
  "satin-drape": { label: "サテンドレープ", description: "光沢のあるサテンのドレープ" },
  "canvas-painted": { label: "ペイントキャンバス", description: "絵画的なキャンバス背景" },

  // Effect
  "bokeh-blur": { label: "ボケブラー", description: "ピント外れのボケ場" },
  "neon-bokeh": { label: "ネオンボケ", description: "彩度の高いネオン色のボケブラー" },
  "halo-glow": { label: "ハローグロー", description: "頭の後ろに輝く円形のハロー" },
  "light-leak": { label: "ライトリーク", description: "レンズフレアのような光漏れの線" },
  "vignette-dark": { label: "ダークヴィネット", description: "重厚なダークヴィネット周辺" },

  // Reflective
  "mirror-floor": { label: "ミラーフロア", description: "反射する鏡面" },
  "polished-floor": { label: "鏡面仕上げの床", description: "光沢のある磨かれた床の反射" },
}

export default map
