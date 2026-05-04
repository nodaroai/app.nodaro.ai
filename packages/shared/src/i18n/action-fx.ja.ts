import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Disaster ──
  "earthquake-tremor": { label: "軽い地震", description: "弱い地揺れ、吊り下げられた物が揺れる" },
  "earthquake-major": { label: "大地震", description: "地面が裂け、瓦礫が落下" },
  "building-collapse": { label: "建物の倒壊", description: "崩れ落ちる構造物" },
  "tsunami-wave": { label: "津波", description: "そびえ立つ水の壁が押し寄せる" },
  "tornado": { label: "竜巻", description: "漏斗状の雲が地面に到達" },
  "hurricane": { label: "ハリケーン", description: "唸る風が木々を曲げ、横殴りの雨" },
  "blizzard-whiteout": { label: "ホワイトアウト", description: "視界を完全に消す猛吹雪" },
  "sandstorm": { label: "砂嵐", description: "シーンを飲み込むオレンジ色の砂塵の壁" },
  "dust-storm-haboob": { label: "砂塵嵐(ハブーブ)", description: "そびえ立つ砂漠の砂塵前線" },
  "wildfire-distant": { label: "遠くの山火事", description: "地平線にオレンジ色の輝きと煙" },
  "wildfire-engulfing": { label: "迫り来る山火事", description: "炎が迫る、強烈な熱の揺らぎ" },
  "volcanic-eruption": { label: "火山噴火", description: "噴き上がる溶岩、噴煙の柱" },
  "lava-flow": { label: "溶岩流", description: "輝く溶融した川が地面を這う" },
  "ash-rain": { label: "降灰", description: "雪のように降る終末的な灰色の火山灰" },
  "avalanche": { label: "雪崩", description: "山腹を転がり落ちる雪の壁" },
  "hailstorm": { label: "雹嵐", description: "大きな雹が表面で跳ね返る" },

  // ── Fire & Blasts ──
  "explosion-small": { label: "小爆発", description: "焦点フラッシュを伴う小規模な爆発" },
  "explosion-large": { label: "大爆発", description: "瓦礫を伴う車両規模の火球" },
  "explosion-massive": { label: "巨大爆発", description: "建物を吹き飛ばす火球と衝撃波" },
  "nuclear-detonation": { label: "核爆発", description: "きのこ雲と地平線を照らす閃光" },
  "fireball-airborne": { label: "空中火球", description: "空中を転がる炎の球" },
  "gas-explosion": { label: "ガス爆発", description: "鮮やかなプロパン式の爆発" },
  "oil-fire": { label: "油火災", description: "高い油性の炎と濃い黒煙" },
  "blazing-inferno": { label: "燃え盛る業火", description: "すべてを焼き尽くす炎の壁" },
  "flame-burst": { label: "火炎放射", description: "素早く方向性のある炎のジェット" },
  "ember-shower": { label: "火の粉のシャワー", description: "輝くオレンジの火の粉が降り注ぐ" },
  "smoke-pillar": { label: "煙の柱", description: "黒煙の高い垂直の柱" },
  "mushroom-cloud": { label: "きのこ雲", description: "古典的なドームと茎の爆発雲" },

  // ── Electric ──
  "lightning-bolt": { label: "稲妻", description: "嵐の空を走る枝分かれする稲光" },
  "lightning-strike-impact": { label: "落雷", description: "光の爆発を伴う地面への落雷" },
  "lightning-storm": { label: "雷嵐", description: "複数の同時発生の落雷" },
  "ball-lightning": { label: "球電", description: "空中に浮かぶ電気プラズマの輝く球体" },
  "plasma-arc": { label: "プラズマアーク", description: "二点間の高電圧連続アーク" },
  "taser-sparks": { label: "テーザーの火花", description: "接触時に弾けるコンパクトな放電" },
  "electric-discharge": { label: "電気放電", description: "故障した装置から弾けるアーク状エネルギー" },
  "transformer-blowout": { label: "変圧器の爆発", description: "電柱上部の青白い爆発" },
  "st-elmos-fire": { label: "セントエルモの火", description: "金属の先端に灯る不気味な青いプラズマ光" },
  "static-shock-burst": { label: "静電気スパーク", description: "目に見える小さな静電気のスパーク" },

  // ── Combat ──
  "muzzle-flash": { label: "マズルフラッシュ", description: "銃口から放たれる鮮やかなオレンジの閃光" },
  "gunshot-impact": { label: "弾痕インパクト", description: "弾丸が表面に当たり破片を撒き散らす" },
  "bullet-trail": { label: "弾道", description: "空中を切り裂く目に見える弾丸の軌跡" },
  "sword-spark": { label: "剣の火花", description: "金属同士の摩擦火花のマクロシャワー" },
  "blade-clash": { label: "刃の衝突", description: "衝撃波を伴う二つの刃の交錯" },
  "ricochet-spark": { label: "跳弾の火花", description: "金属に跳ね返る弾丸と火花" },
  "debris-field": { label: "瓦礫の雨", description: "空中に静止した破片が四方に散る" },
  "glass-shatter-airborne": { label: "空中ガラス破裂", description: "宙に浮かぶ無数の破片に砕け散るガラス" },
  "shockwave-ground": { label: "地表衝撃波", description: "地表に広がる目に見える環状衝撃波" },
  "sonic-boom": { label: "ソニックブーム", description: "超音速での圧縮空気の円錐" },
  "smoke-grenade": { label: "煙幕弾", description: "色付きの濃い煙が外側に広がる" },
  "flashbang": { label: "閃光手榴弾", description: "視界を奪う白い閃光の爆発" },
  "blood-spray": { label: "血しぶき", description: "映画的な血滴の弧" },
  "arrow-hit-spark": { label: "矢の着弾火花", description: "矢が刺さる瞬間の小さな火花" },

  // ── Sci-Fi ──
  "laser-blast": { label: "レーザー砲撃", description: "明るく集束したエネルギービーム" },
  "energy-beam": { label: "エネルギービーム", description: "プラズマエネルギーの幅広く脈動するビーム" },
  "plasma-bolt": { label: "プラズマ弾", description: "蒸気の航跡を引く光る弾丸" },
  "force-field-shimmer": { label: "フォースフィールドの揺らぎ", description: "六角形パターンの半透明エネルギー障壁" },
  "force-field-impact": { label: "フォースフィールドへの衝撃", description: "発射体がシールドに当たる目に見える波紋" },
  "portal-opening": { label: "ポータルの開放", description: "空間を引き裂くエネルギーの渦" },
  "warp-distortion": { label: "ワープ歪曲", description: "物体の周囲で曲がる時空" },
  "hologram-flicker": { label: "ホログラムのちらつき", description: "ノイズが走る半透明の投影" },
  "ion-storm": { label: "イオンストーム", description: "宇宙的背景に荷電粒子の弾ける場" },
  "antimatter-flash": { label: "反物質の閃光", description: "現実を引き裂く純白エネルギーの爆発" },

  // ── Magic ──
  "fireball-spell": { label: "ファイアボール呪文", description: "手から放たれる渦巻く火の球" },
  "magic-aura": { label: "魔法のオーラ", description: "人物を包む輝くエネルギーの光輪" },
  "summoning-glyph": { label: "召喚紋", description: "地面に描かれた光る魔法陣" },
  "lightning-magic": { label: "雷の魔法", description: "術者の手から弧を描く電気の魔術" },
  "ice-shard-burst": { label: "氷の破片爆裂", description: "外側に飛び散る結晶の破片" },
  "energy-rune": { label: "エネルギールーン", description: "宙に浮かぶ光る秘術のシンボル" },
  "portal-magic": { label: "魔法のポータル", description: "空間に渦巻く神秘的な扉" },
  "healing-glow": { label: "癒しの輝き", description: "術者から放たれる暖かい黄金の光" },
  "dark-vortex": { label: "ダークボルテックス", description: "不吉に渦巻く黒紫の虚空" },
  "light-explosion": { label: "光の爆発", description: "純粋な白金色の輝きの爆発" },
}

export default map
