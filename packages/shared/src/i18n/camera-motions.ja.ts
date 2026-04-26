import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Default
  "auto": { label: "オート", description: "適切なカメラモーションをモデルに選ばせる" },
  "static": { label: "固定", description: "固定カメラ、動きなし" },
  "handheld": { label: "ハンドヘルド", description: "自然な手持ちの揺れ" },
  "steadicam": { label: "ステディカム", description: "滑らかに安定した歩行ショット" },

  // Pan
  "pan-left": { label: "パン・レフト", description: "カメラを水平に左へ回転させる" },
  "pan-right": { label: "パン・ライト", description: "カメラを水平に右へ回転させる" },
  "whip-pan-left": { label: "ウィップパン・レフト", description: "モーションブラーを伴う高速の左ウィップパン" },
  "whip-pan-right": { label: "ウィップパン・ライト", description: "モーションブラーを伴う高速の右ウィップパン" },

  // Tilt
  "tilt-up": { label: "ティルト・アップ", description: "カメラを上へ傾ける" },
  "tilt-down": { label: "ティルト・ダウン", description: "カメラを下へ傾ける" },

  // Zoom
  "zoom-in": { label: "ズームイン", description: "被写体に向かってレンズをズームする" },
  "zoom-out": { label: "ズームアウト", description: "被写体から離れてレンズをズームする" },
  "crash-zoom-in": { label: "クラッシュズーム・イン", description: "ぱっと切れ味のあるウィップ式ズームイン" },
  "crash-zoom-out": { label: "クラッシュズーム・アウト", description: "ぱっと切れ味のあるウィップ式ズームアウト" },

  // Dolly
  "dolly-in": { label: "ドリー・イン", description: "被写体に向かってカメラを押し込む（パララックスあり）" },
  "dolly-out": { label: "ドリー・アウト", description: "カメラを引いていく（パララックスあり）" },
  "dolly-zoom": { label: "ドリーズーム", description: "ヴァーティゴ効果：ドリーがズームと逆方向" },
  "push-in": { label: "プッシュイン", description: "被写体へのゆっくり繊細な押し込み" },
  "pull-out": { label: "プルアウト", description: "被写体からのゆっくり繊細な引き戻し" },

  // Truck
  "truck-left": { label: "トラック・レフト", description: "カメラ本体を横方向に左へスライドさせる" },
  "truck-right": { label: "トラック・ライト", description: "カメラ本体を横方向に右へスライドさせる" },

  // Pedestal
  "pedestal-up": { label: "ペデスタル・アップ", description: "カメラ本体を垂直に上げる" },
  "pedestal-down": { label: "ペデスタル・ダウン", description: "カメラ本体を垂直に下げる" },

  // Roll
  "roll-left": { label: "ロール・レフト", description: "カメラを反時計回りに回転させる" },
  "roll-right": { label: "ロール・ライト", description: "カメラを時計回りに回転させる" },
  "dutch-angle": { label: "ダッチアングル", description: "緊張感を与える固定の傾いたフレーム" },

  // Orbit
  "orbit-left": { label: "オービット・レフト", description: "被写体の周りを左に1周回る" },
  "orbit-right": { label: "オービット・ライト", description: "被写体の周りを右に1周回る" },
  "arc-left": { label: "アーク・レフト", description: "被写体の周りを左に部分的に弧を描く" },
  "arc-right": { label: "アーク・ライト", description: "被写体の周りを右に部分的に弧を描く" },

  // Crane
  "crane-up": { label: "クレーン・アップ", description: "シーンを明らかにする壮大なクレーンの上昇" },
  "crane-down": { label: "クレーン・ダウン", description: "壮大なクレーンの下降" },
  "boom-up": { label: "ブーム・アップ", description: "ブームアームの上昇" },
  "boom-down": { label: "ブーム・ダウン", description: "ブームアームの下降" },

  // Tracking
  "tracking-shot": { label: "トラッキングショット", description: "動く被写体に並走してカメラがトラッキングする" },
  "follow": { label: "フォロー", description: "被写体を後ろから追う" },
  "lead": { label: "リード", description: "進む被写体の前方を移動する" },
  "drone-follow": { label: "ドローン・フォロー", description: "上空のドローンが被写体をトラッキング" },
  "dolly-track": { label: "ドリー・トラック", description: "被写体に並走するドリー軌道" },

  // Special
  "pov": { label: "POV", description: "一人称視点" },
  "over-the-shoulder": { label: "オーバー・ザ・ショルダー", description: "キャラクターの肩越しのフレーミング" },
  "birds-eye": { label: "バーズアイ", description: "真下を見下ろす俯瞰ビュー" },
  "worms-eye": { label: "ワームズアイ", description: "極端なローアングルから見上げる" },
  "aerial": { label: "エアリアル", description: "高高度のドローン風ショット" },
  "helicopter": { label: "ヘリコプター", description: "高高度を広くなめる空撮" },
  "fly-over": { label: "フライオーバー", description: "シーンの上を低く速く通過する空撮" },
  "flythrough": { label: "フライスルー", description: "空間を通り抜けるように飛ぶカメラ" },
  "reveal": { label: "リヴィール", description: "より広いシーンを徐々に見せる" },
  "snorricam": { label: "スノリカム", description: "体に取り付けたカメラ（被写体がフレームに固定）" },
  "rack-focus": { label: "ラックフォーカス", description: "前景と背景の間でフォーカスを引く" },

  // Modern / social
  "handheld-vlog": { label: "ハンドヘルド・ヴログ", description: "カジュアルなヴログ風の手持ち" },
  "pov-walk": { label: "POVウォーク", description: "一人称の歩行POV" },
  "velocity-edit": { label: "ベロシティエディット", description: "TikTok風のスピードランプ・ペーシング" },
  "match-cut-zoom": { label: "マッチカット・ズーム", description: "カット用にビートに合わせたズーム" },
  "screen-tap": { label: "スクリーンタップ", description: "画面上の指タップによるトランジション" },
  "phone-flip": { label: "フォンフリップ", description: "前面／背面カメラの切り替え" },
}

export default map
