import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Shot size
  "extreme-wide-shot": { label: "エクストリーム・ワイドショット", description: "広大な環境の中で被写体が小さく見える" },
  "wide-shot": { label: "ワイドショット", description: "周囲を含めた全身" },
  "medium-wide-shot": { label: "ミディアム・ワイド", description: "膝から上の被写体" },
  "medium-shot": { label: "ミディアムショット", description: "腰から上の被写体" },
  "medium-close-up": { label: "ミディアム・クローズアップ", description: "胸から上の被写体" },
  "close-up": { label: "クローズアップ", description: "顔がフレームを満たす" },
  "extreme-close-up": { label: "エクストリーム・クローズアップ", description: "顔の特徴部分のタイトな詳細" },
  "ecu-eye": { label: "ECU：目", description: "Sergio Leone風のエクストリーム・クローズアップ、片目に寄った構図" },
  "ecu-mouth": { label: "ECU：唇／口", description: "口、唇、歯に寄ったエクストリーム・クローズアップ" },
  "ecu-hands": { label: "ECU：手", description: "手に寄ったエクストリーム・クローズアップ" },
  "big-close-up": { label: "ビッグ・クローズアップ（BCU）", description: "標準のクローズアップよりタイトに、顎から額までの顔のみ" },
  "choker": { label: "チョーカーショット", description: "喉のラインで構図、頭と首だけ、親密な強度" },
  "italian-shot": { label: "イタリアンショット／トリニティショット", description: "Sergio Leoneのウエスタン定番：目だけにクロップしたECU" },
  "insert": { label: "インサート", description: "物体のディテールショット" },
  "macro": { label: "マクロ", description: "小さな被写体の極端な拡大" },
  "full-shot": { label: "フルショット", description: "頭からつま先まで全身がフレーム内に収まる" },
  "cowboy-shot": { label: "カウボーイショット", description: "太もも中央から上、クラシックな西部劇のフレーミング" },
  "head-to-knees": { label: "頭から膝まで", description: "頭から膝までを写す" },
  "head-to-hip": { label: "頭から腰まで", description: "頭から腰までを写す" },
  "half-body": { label: "ハーフボディ", description: "クリーンな腰上のポートレート" },

  // Angle
  "eye-level": { label: "目線の高さ", description: "被写体の目の高さにカメラ" },
  "high-angle": { label: "ハイアングル", description: "被写体の上から見下ろすカメラ" },
  "low-angle": { label: "ローアングル", description: "被写体の下から見上げるカメラ" },
  "overhead": { label: "オーバーヘッド", description: "真上からの神の視点" },
  "worms-eye-angle": { label: "ワームズアイ", description: "地面からの極端なローアングル" },
  "dutch-angle": { label: "ダッチアングル", description: "傾けたカントの水平線" },
  "birds-eye": { label: "バーズアイ", description: "高い空中からの俯瞰ビュー" },
  "slightly-downward": { label: "わずかに下向き", description: "上から軽く傾けた自撮り風" },

  // Coverage
  "single": { label: "シングル", description: "1人だけのクリーンなショット" },
  "two-shot": { label: "ツーショット", description: "2人の被写体がフレーム内" },
  "three-shot": { label: "スリーショット", description: "3人の被写体がフレーム内" },
  "over-the-shoulder-framing": { label: "オーバー・ザ・ショルダー", description: "1人の肩越しに別の人物を見る" },
  "reverse-shot": { label: "リバースショット", description: "前のショットの逆視点" },
  "pov-framing": { label: "POV", description: "被写体の目を通した視点" },
  "selfie-framing": { label: "セルフィー", description: "腕を伸ばした自撮り" },
  "mirror-selfie": { label: "鏡の自撮り", description: "鏡の反射に映るスマホ" },
  "gym-mirror-selfie": { label: "ジムの鏡自撮り", description: "ジムの鏡越しに3/4横後ろからの角度" },
  "through-glass": { label: "ガラス越し", description: "前景のガラス越しのフレーミング" },
  "top-down-flat-lay": { label: "トップダウン・フラットレイ", description: "表面に並べられた物の俯瞰配置" },
  "establishing-shot": { label: "エスタブリッシングショット", description: "被写体は小さく、広い環境ショット" },
  "dirty-single": { label: "ダーティ・シングル", description: "別の人物が端に少し映り込むシングル" },

  // Composition
  "rule-of-thirds": { label: "三分割法", description: "三分割の交点に被写体を配置" },
  "centered": { label: "中央配置", description: "被写体を中央に置いた左右対称構図" },
  "headroom-tight": { label: "ヘッドルーム・タイト", description: "被写体の頭がフレーム上端近く" },
  "negative-space": { label: "ネガティブスペース", description: "被写体を片側に寄せて空きを作る" },
  "leading-lines": { label: "リーディングライン", description: "線が視線を被写体へ導く" },
  "3x3-grid-collage": { label: "3×3グリッド・コラージュ", description: "3×3グリッドで複数バリエーション" },
  "diptych": { label: "ディプティク", description: "2枚並べた構図" },
  "triptych": { label: "トリプティク", description: "3枚並べた構図" },
  "multi-frame-mosaic": { label: "マルチフレーム・モザイク", description: "小さなタイルから構成された顔のモザイク" },
  "contact-sheet": { label: "コンタクトシート", description: "サムネイルのコンタクトシート風配置" },
  "magazine-spread": { label: "雑誌見開き", description: "タイポグラフィ付きの雑誌2ページ見開きレイアウト" },
  "cutaway-cross-section": { label: "カットアウェイ／断面", description: "壁を剥がした建築断面図" },

  // Vantage
  "front-on": { label: "正面", description: "被写体がカメラに正対する" },
  "three-quarter-front": { label: "前方3/4", description: "正面からわずかにずれた角度" },
  "profile-left": { label: "左プロフィール", description: "被写体の左側の横顔" },
  "profile-right": { label: "右プロフィール", description: "被写体の右側の横顔" },
  "three-quarter-back": { label: "後方3/4", description: "後ろからのオフアクシス" },
  "behind": { label: "真後ろ", description: "真後ろからの視点" },
  "side-back-angle": { label: "サイドバック・アングル", description: "片肩越しの3/4後方ビュー" },

  // Additional composition
  "golden-spiral": { label: "黄金螺旋", description: "フィボナッチ比の螺旋に基づく構図" },
  "frame-within-frame": { label: "フレーム・イン・フレーム", description: "室内の建築要素で被写体を囲む構図" },
  "s-curve": { label: "S字カーブ", description: "視線を導くしなやかな対角の流れ" },
  "diagonal-composition": { label: "対角構図", description: "フレームを横切る強い対角線" },
  "triangular-composition": { label: "三角構図", description: "三点による三角形の配置" },
  "symmetrical-mirror": { label: "シンメトリー／ミラー", description: "完全な左右対称" },
  "vignette-composition": { label: "ヴィネット", description: "周辺を強く暗くして中央に焦点を集める" },
}

export default map
