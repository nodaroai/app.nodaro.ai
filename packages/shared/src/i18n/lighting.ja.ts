import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Time of day
  "sunrise": { label: "日の出", description: "暖かな低い太陽、長い影" },
  "golden-hour": { label: "ゴールデンアワー", description: "夕暮れの暖かな輝き" },
  "noon": { label: "正午", description: "頭上からの厳しい真昼の太陽" },
  "harsh-midday": { label: "厳しい真昼", description: "白い太陽が真上にある真昼" },
  "overcast": { label: "曇天", description: "柔らかく拡散した昼光" },
  "blue-hour": { label: "ブルーアワー", description: "クールな夕方のトワイライト" },
  "twilight": { label: "トワイライト", description: "ブルーアワーと夜の間" },
  "night": { label: "夜", description: "深い夜、低いアンビエント" },
  "moonlight": { label: "月明かり", description: "クールな青の月光のシーン" },
  "neon-night": { label: "ネオンナイト", description: "彩度の高いネオンの都会の夜" },

  // Style
  "three-point": { label: "三点照明", description: "クラシックなキー＋フィル＋バック" },
  "rembrandt": { label: "レンブラント", description: "頬に三角形の光" },
  "chiaroscuro": { description: "強い明暗のコントラスト" },
  "silhouette": { label: "シルエット", description: "純粋な形状としての被写体" },
  "high-key": { label: "ハイキー", description: "明るく低コントラスト" },
  "low-key": { label: "ローキー", description: "暗く高コントラスト" },
  "split": { label: "スプリット照明", description: "顔の半分が照らされ半分が影" },
  "hard": { label: "ハード", description: "鋭い縁の影" },
  "soft": { label: "ソフト", description: "拡散した穏やかな光" },
  "practical": { label: "プラクティカル", description: "シーン内の見える光源" },
  "ring-light": { label: "リングライト", description: "ビューティ／ヴログのリング状キャッチライト" },
  "phone-screen-glow": { label: "スマホ画面の光", description: "クールな画面のアンダーライト" },
  "selfie-natural": { label: "自然光の自撮り", description: "窓の光を使った自撮り" },
  "natural": { label: "自然光", description: "利用可能なアンビエント光" },
  "volumetric": { label: "ヴォリュメトリック", description: "霞の中で目に見える光線" },
  "noir": { description: "高コントラストの白黒フィルム・ノワール" },
  "on-camera-flash": { label: "オンカメラ・フラッシュ", description: "パパラッチ／iPhoneの直接フラッシュ" },
  "mirror-bounce-flash": { label: "ミラーバウンス・フラッシュ", description: "鏡自撮りのフラッシュ反射" },
  "bounced-flash": { label: "バウンスフラッシュ", description: "天井反射の柔らかなフィル" },
  "softbox-key": { label: "ソフトボックス・キー", description: "大きく拡散したファッション系のキーライト" },
  "beauty-dish": { label: "ビューティーディッシュ", description: "ヒーローライト、シャープな減光" },
  "gridded-snoot": { label: "グリッドスヌート", description: "タイトに集中した光のプール" },
  "silk-diffusion": { label: "シルクディフュージョン", description: "シルクで柔らかく和らげたキー" },
  "kicker-rim": { label: "キッカー／リムアクセント", description: "低い側面のアクセントによる分離" },
  "candlelight": { label: "ろうそくの光", description: "暖かく揺らめく炎の明かり" },
  "edison-tungsten": { label: "エジソン・タングステン", description: "落ち着いた暖かいグローブ電球の光" },
  "dappled-light": { label: "木漏れ日／葉のフィルター", description: "木の葉を通した斑模様の光" },
  "raking-sidelight": { label: "レーキング・サイドライト", description: "極端な低い側面、質感を引き出す" },
  "stage-spotlight": { label: "ステージ・スポットライト", description: "上からの単一のハードスポット" },
  "underwater-caustics": { label: "水中コースティクス", description: "波紋状に屈折したパターン" },
  "bioluminescence": { label: "生物発光", description: "クールで不気味な生物的な輝き" },

  // Direction
  "front": { label: "正面", description: "カメラ方向からの光" },
  "three-quarter": { label: "3/4ライト", description: "クラシックなポートレートのキー角度" },
  "side": { label: "サイド", description: "片側からの光" },
  "back-rim": { label: "バック／リム", description: "被写体の周囲にリムを作る逆光" },
  "silhouette-backlight": { label: "シルエット・バックライト", description: "明るいハロー、暗い被写体" },
  "top-overhead": { label: "トップ／真上", description: "真上からの光" },
  "under-uplight": { label: "下／アップライト", description: "下からの光" },
  "window": { label: "窓", description: "窓からの柔らかなサイドライト" },

  // Lighting ratio — keep technical labels (1:1, 1:2, etc.)
  "ratio-1-1": { description: "フラット、影のコントラストなし" },
  "ratio-1-2": { description: "柔らかな1段の減光" },
  "ratio-1-3": { description: "中程度の2段コントラスト" },
  "ratio-1-4": { description: "強いエディトリアル・コントラスト" },
  "ratio-1-8": { description: "極端なローキーのキアロスクーロ" },
  "ratio-1-16": { description: "単一光源のフィルム・ノワール的減光" },

  // Color temperature — keep K labels
  "temp-2700k": { description: "深い琥珀色のキャンドル／タングステン" },
  "temp-3200k": { description: "暖かい黄色の室内光" },
  "temp-4000k": { description: "ニュートラルな白" },
  "temp-5600k": { description: "昼光バランスの真昼の太陽" },
  "temp-6500k": { description: "わずかにクールな青みのキャスト" },
  "temp-9000k": { description: "明らかにクールな青みのシェード" },
}

export default map
