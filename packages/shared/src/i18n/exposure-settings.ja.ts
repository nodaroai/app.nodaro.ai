import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Aperture — keep f-stop labels (technical units)
  "aperture-f1-2": { description: "極薄の被写界深度、夢のようなボケ" },
  "aperture-f1-4": { description: "被写体を背景から大胆に切り離す" },
  "aperture-f1-8": { description: "クラシックなポートレートの分離" },
  "aperture-f2-8": { description: "被写体はシャープ、背景は柔らかく" },
  "aperture-f4": { description: "バランスの取れた日常的な被写界深度" },
  "aperture-f5-6": { description: "被写体全体がシャープ" },
  "aperture-f8": { description: "スイートスポットのシャープネス" },
  "aperture-f11": { description: "風景向けの深い被写界深度" },
  "aperture-f16": { description: "ハイパーフォーカル、太陽の光条" },

  // Shutter Speed — keep technical labels
  "shutter-1-30": { label: "1/30（手ブレ）", description: "手持ちブレのほのかな気配" },
  "shutter-1-60": { description: "標準的な日常用シャッター" },
  "shutter-1-200": { description: "ほとんどの被写体でシャープ" },
  "shutter-1-500": { description: "素早いアクションでもシャープ" },
  "shutter-1-1000": { label: "1/1000（動きを止める）", description: "動きを止めたスポーツ／野生動物" },
  "shutter-long-1s": { label: "長時間露光（1秒）", description: "光の筋と動きの軌跡" },

  // ISO — keep ISO numeric labels
  "iso-100": { label: "ISO 100（ノイズなし）", description: "ノイズ最小、細かい粒子" },
  "iso-400": { description: "わずかな質感、毎日使えるISO" },
  "iso-800": { description: "目に見えるが心地よい粒子" },
  "iso-1600": { label: "ISO 1600（粒子が見える）", description: "エディトリアルな低光量の質感" },
  "iso-3200": { label: "ISO 3200（強い粒子）", description: "増感処理によるざらついたドキュメンタリー感" },
}

export default map
