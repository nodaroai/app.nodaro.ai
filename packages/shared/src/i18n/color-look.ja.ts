import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Palette
  "warm": { label: "ウォーム", description: "暖かいオレンジ／赤のトーン" },
  "cool": { label: "クール", description: "クールな青／ティールのトーン" },
  "teal-orange": { label: "ティール＆オレンジ", description: "ハリウッド風の補色グレーディング" },
  "split-toning": { label: "スプリットトーニング", description: "クールなシャドウ、暖かいハイライト" },
  "selective-color": { label: "セレクティブカラー", description: "1色のアクセントを残した白黒" },
  "faded-matte": { label: "フェイデッドマット", description: "ブラックを持ち上げた、ミルキーな低コントラスト" },
  "log-flat": { label: "ログフラット", description: "グレーディング前のS-Log/V-Logニュートラル" },
  "desaturated": { label: "低彩度", description: "低彩度で落ち着いた色" },
  "monochrome-bw": { label: "モノクロ", description: "純粋な白黒" },
  "sepia": { label: "セピア", description: "ヴィンテージのブラウントーン" },
  "pastel": { label: "パステル", description: "柔らかく低コントラストなパステル" },
  "high-contrast": { label: "ハイコントラスト", description: "パンチのあるコントラストと深い黒" },
  "vibrant": { label: "ビビッド", description: "高彩度の色彩" },

  // Film emulation
  "kodak-portra": { description: "柔らかな肌色と細かい粒子" },
  "kodak-ektar": { description: "高彩度できめ細かな粒子" },
  "kodak-vision3": { description: "シネマ用ムービーフィルムストック" },
  "fuji-pro-400h": { description: "パステル調のグリーンと空" },
  "cinestill-800t": { description: "赤いハレーションを伴うタングステンフィルム" },
  "bleach-bypass": { label: "ブリーチバイパス", description: "ハイコントラストで低彩度" },
  "technicolor": { label: "スリーストリップ・テクニカラー", description: "鮮やかなレトロ・テクニカラー" },
  "two-strip-technicolor": { label: "ツーストリップ・テクニカラー", description: "1920〜30年代の赤青テクニカラー" },
  "eastman-color": { description: "1950〜60年代の暖かく褪せたフィルムストック" },
  "hand-tinted": { label: "手彩色", description: "手で彩色を加えた白黒" },
  "agfa-orwo": { description: "東欧のクールなグリーン調" },
  "day-for-night": { label: "デイ・フォー・ナイト", description: "昼光を夜としてグレーディング" },
  "cross-processed": { label: "クロスプロセス", description: "クロス現像による色の変化" },

  // Social-preset
  "instagram-warm": { label: "Instagramウォーム", description: "Valencia風の暖色フィルター" },
  "tiktok-saturated": { label: "TikTok 高彩度", description: "明るくパンチの効いた SNS 向けの色使い" },
  "youtube-vlog-flat": { label: "YouTube Vlog フラット", description: "クリーンな Vlog 向けフラットグレーディング" },
  "iphone-hdr": { description: "コンピュテーショナル HDR のルック" },
  "y2k-saturated": { label: "Y2K 高彩度", description: "2000年代初頭のデジタルポップ" },
  "mtv-90s-vhs": { label: "MTV 90s VHS", description: "彩度過多の90年代VHSクロマ" },
  "polaroid-faded": { label: "ポラロイド・フェイデッド", description: "マゼンタ調に褪せたポラロイド" },
  "lifestyle-warm-magazine": { label: "暖色系ライフスタイル誌", description: "モダンな暖色エディトリアル・グレーディング" },

  // Additional film stocks — names kept English
  "kodachrome-64": { description: "彩度の高い赤と黄金色の暖かみ" },
  "ektachrome-100": { description: "クールでクリーンな青、スライドフィルムの透明感" },
  "kodak-tri-x-400": { description: "増感で粒子が際立つ白黒のルポルタージュ" },
  "aerochrome": { description: "シュールなピンクとマゼンタに染まった草木" },
  "fuji-instax": { description: "柔らかなパステル調のインスタントフィルム" },
  "cinestill-50d": { description: "デイライト用のシネマフィルムストック" },
  "expired-film": { label: "期限切れフィルム", description: "色のシフトと光漏れ" },
}

export default map
