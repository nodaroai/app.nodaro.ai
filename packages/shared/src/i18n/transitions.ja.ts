import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Standard ──
  "auto": { label: "自動", description: "モデルに任せる" },
  "none": { label: "ハードカット", description: "瞬時の切替、トランジションなし" },
  "cross-dissolve": { label: "クロスディゾルブ", description: "ショット間の緩やかなブレンド" },
  "fade-to-black": { label: "暗転", description: "暗転後、次のシーンが浮かび上がる" },
  "fade-to-white": { label: "ホワイトアウト", description: "白飛び後、次のシーンが現れる" },
  "match-cut": { label: "マッチカット", description: "形や動きを合わせたカット" },
  "smash-cut": { label: "スマッシュカット", description: "対照的なシーン間の衝撃的な急転" },
  "iris": { label: "アイリス", description: "円形のアイリスが閉じ、次のシーンで開く" },
  "wipe": { label: "ワイプ", description: "直線的なワイプで次のシーンへ" },
  "roll-transition": { label: "ロール", description: "フレームが90〜180°回転して次のシーンへ" },
  "seamless-match": { label: "シームレスカット", description: "動きと色で隠された完全なシームレスカット" },

  // ── Time ──
  "fast-forward-day-night": { label: "日中→夜 早送り", description: "同じ場面の昼から夜へのタイムラプス" },
  "fast-forward-night-day": { label: "夜→夜明け 早送り", description: "同じ場面の夜から夜明けへのタイムラプス" },
  "seasonal-shift": { label: "季節の変遷", description: "同じ場面で四季が移り変わる" },
  "aging": { label: "エイジング", description: "被写体が目に見えて老いる" },
  "rewind": { label: "巻き戻し", description: "時間が逆行し、動きが逆再生される" },
  "freeze-frame-jump": { label: "フリーズフレームジャンプ", description: "動きが止まり、時間が飛んで再開" },
  "weather-shift": { label: "天気の変化", description: "同じ場面で天気が変わる" },
  "flashback": { label: "フラッシュバック", description: "過去の記憶へのフラッシュバック" },

  // ── Element ──
  "dissolve-to-mist": { label: "霧に溶ける", description: "被写体が霧に変わり漂い、再形成される" },
  "water-splash": { label: "水しぶき", description: "被写体が水に変わりはね、再形成される" },
  "sand-scatter": { label: "砂の散乱", description: "被写体が砂に変わり吹き飛び、再形成される" },
  "fire-burnup": { label: "燃え尽き", description: "被写体が燃えて炭になり、再形成される" },
  "smoke-puff": { label: "煙幕消滅", description: "被写体が煙で消えて再び現れる" },
  "magic-sparkles": { label: "魔法の輝き", description: "アベンジャーズ風のパーティクル消滅" },
  "lightning-flash": { label: "雷光", description: "稲妻がフレームを走り、閃光の中でシーン転換" },
  "ink-splash": { label: "インクスプラッシュ", description: "インクがフレームを覆い、引いて新シーンへ" },
  "sand-storm": { label: "砂嵐", description: "砂嵐がフレームを包み、中でシーン転換" },
  "paint-splash": { label: "ペイントスプラッシュ", description: "鮮やかな絵の具が広がり引いて新シーンへ" },
  "aurora-sweep": { label: "オーロラ", description: "オーロラのカーテンが流れてシーン転換" },
  "sakura-petals": { label: "桜吹雪", description: "桜の花びらの嵐がフレームを横切る" },
  "garden-bloom": { label: "庭の開花", description: "花が咲き広がり、カーテンのように開いて新シーン" },
  "powder-burst": { label: "カラーパウダー", description: "色粉が爆発して広がり、晴れると新シーン" },

  // ── Morph ──
  "liquid-morph": { label: "液体モーフ", description: "被写体が液体に変わり、新しい被写体に変形" },
  "pixelate-reform": { label: "ピクセル化変形", description: "ピクセル化して散り、再構成される" },
  "shatter-glass": { label: "ガラス粉砕", description: "被写体がガラスのように砕けて再形成" },
  "origami-fold": { label: "折り紙変形", description: "被写体が紙のように折れて新しい形へ" },
  "vortex-swirl": { label: "渦巻き変形", description: "被写体が渦に巻き込まれ、解けて新しい形へ" },
  "dream-ripple": { label: "夢の波紋", description: "水面の波紋のように広がり新シーンへ" },
  "wireframe-morph": { label: "ワイヤーフレーム変形", description: "ワイヤーフレームに還元されて新しい被写体に再構成" },
  "polygon-shatter": { label: "ポリゴン粉砕", description: "ローポリの破片に砕け、新しい被写体に再構成" },
  "melt-down": { label: "溶解変形", description: "被写体が溶けて水たまりになり、新しい形へ" },

  // ── Portal ──
  "zoom-into-eye": { label: "瞳へのズーム", description: "瞳孔へ接近し、内側に新しい世界が" },
  "zoom-into-mirror": { label: "鏡へのズーム", description: "鏡へ接近し、反射の世界へ" },
  "zoom-into-screen": { label: "スクリーンへのズーム", description: "TV・スマホ・モニターへのプッシュ" },
  "zoom-into-book": { label: "本へのズーム", description: "本のイラストへ接近し、中に入る" },
  "walk-through-door": { label: "扉をくぐる", description: "扉を通って新しいシーンへ" },
  "fall-into-hole": { label: "穴への落下", description: "開口部を通ってカメラが落下" },
  "pull-out-reveal": { label: "引き戻しリビール", description: "シーンが大きな文脈の中の絵だったと判明" },
  "zoom-into-mouth": { label: "口へのズーム", description: "開いた口へ接近し、内側に新しい世界が" },
  "push-through-glass": { label: "ガラスをすり抜ける", description: "ガラス面をカメラが屈折しながら通り抜ける" },
  "soul-jump": { label: "魂の跳躍", description: "半透明の魂が体を出て新しい体へ入る" },

  // ── Physics ──
  "explosion-blast": { label: "爆発", description: "爆発がフレームを吹き飛ばし、新シーンへ" },
  "shockwave": { label: "衝撃波", description: "衝撃波がフレームを歪め、シーン転換" },
  "punch-into-camera": { label: "カメラへのパンチ", description: "拳がカメラを直撃し、シーン転換" },
  "debris-shower": { label: "瓦礫シャワー", description: "瓦礫が横切り、後ろのシーンが変わる" },
  "gravity-flip": { label: "重力反転", description: "重力が反転し、カメラが180°回転" },
  "building-explosion": { label: "建物爆発", description: "建造物が爆発し、煙の中でシーン転換" },
  "vehicle-explosion": { label: "車両爆発", description: "前景の車両が爆発し、煙が晴れると新シーン" },
  "jump-match": { label: "ジャンプマッチ", description: "被写体が跳び、着地が新しいシーンに合致" },
  "hand-swipe": { label: "手のスワイプ", description: "手がレンズを横切り、遮蔽中にシーン転換" },

  // ── Light ──
  "white-flash": { label: "ホワイトフラッシュ", description: "フレームが純白に膨らむ" },
  "lens-flare-swipe": { label: "フレアスワイプ", description: "アナモルフィックフレアがフレームを横断" },
  "light-streak": { label: "光の閃光", description: "光の筋がフレームを走り抜ける" },
  "color-invert": { label: "色反転フラッシュ", description: "一瞬、色が反転する" },
  "sun-glare": { label: "太陽のグレア", description: "強烈な日差しがフレームを白飛びさせる" },
  "lens-crack": { label: "レンズクラック", description: "レンズにひびが入り、割れたガラス越しに新シーン" },
  "dirty-lens-wipe": { label: "汚れたレンズ拭き", description: "レンズの汚れが拭われ、シーンが変わる" },
  "eye-light-burst": { label: "眼光", description: "被写体の瞳から白光が放たれ、フレームが白飛び" },

  // ── Glitch ──
  "digital-glitch": { label: "デジタルグリッチ", description: "RGB分離+スキャンライン+データモッシュ" },
  "vhs-rewind": { label: "VHSリワインド", description: "VHSテープ巻き戻し風のトラッキング歪み" },
  "datamosh": { label: "データモッシュ", description: "モーションベクターがシーンをにじませる" },
  "channel-flip": { label: "チャンネル切替", description: "TV静電気ノイズとともにチャンネルが変わる" },
  "hologram-flicker": { label: "ホログラムちらつき", description: "ホログラム風のちらつきで新シーンが出現" },
  "display-wipe": { label: "ディスプレイワイプ", description: "シーンが画面に圧縮され、展開して新シーンへ" },
  "double-exposure": { label: "多重露光", description: "二つのシーンが重なり、前景が徐々に消える" },
}

export default map
