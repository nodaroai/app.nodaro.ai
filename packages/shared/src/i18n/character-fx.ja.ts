import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Transformation ──
  "auto": { label: "自動", description: "モデルに任せる" },
  "none": { label: "なし", description: "キャラクターエフェクトなし" },
  "werewolf": { label: "狼人間", description: "狼男に変身する" },
  "vampire": { label: "ヴァンパイア", description: "吸血鬼に変身する" },
  "cyborg": { label: "サイボーグ化", description: "皮膚が裂けてサイバネティクスが露出" },
  "ghost-form": { label: "霊体化", description: "体が半透明の霊的存在になる" },
  "statue-stone": { label: "石化", description: "体が石像に変わる" },
  "liquid-metal": { label: "液体金属", description: "T-1000スタイルの液体クロム化" },
  "animalization": { label: "動物化", description: "動物に変身する" },
  "gorilla-form": { label: "ゴリラ化", description: "シルバーバックゴリラに変身する" },
  "mystification": { label: "神秘的変身", description: "魔法のオーラに包まれて変容する" },
  "gas-form": { label: "気体化", description: "体が気体状に溶け、再凝縮する" },
  "diamond-skin": { label: "ダイヤモンド肌", description: "体がダイヤモンドのファセットに結晶化" },
  "agent-reveal": { label: "エージェント変身", description: "スーツとサングラスが出現する" },

  // ── Power ──
  "fire-breathe": { label: "火炎放射", description: "持続する炎のジェットを吐く" },
  "ice-breathe": { label: "氷の息吹", description: "凍てつく冷気の流れを吐く" },
  "air-bending": { label: "エアベンディング", description: "渦巻く空気の渦を操作する" },
  "water-bending": { label: "ウォーターベンディング", description: "ジェスチャーで水を自在に操る" },
  "earth-bending": { label: "アースベンディング", description: "地面から石板を持ち上げる" },
  "lightning-hands": { label: "電撃の手", description: "手から電気の弧が放たれる" },
  "levitation": { label: "浮遊", description: "地面から浮き上がる" },
  "telekinesis": { label: "サイコキネシス", description: "近くの物体が浮いて周回する" },
  "invisibility": { label: "透明化", description: "体が透明な屈折シマーになる" },
  "hero-flight": { label: "ヒーロー飛行", description: "スーパーヒーローの姿勢で空へ飛び立つ" },
  "super-speed": { label: "超高速", description: "残像を残しながら超高速で移動" },
  "soul-departure": { label: "魂の離脱", description: "半透明の魂が体から浮き上がる" },

  // ── Body-Mod ──
  "wings-grow": { label: "翼の展開", description: "背中から翼が生えて広がる" },
  "horns-grow": { label: "角の出現", description: "頭から角が突き出る" },
  "tail-emerge": { label: "尻尾の出現", description: "脊椎の根元から尻尾が伸びる" },
  "tentacles-emerge": { label: "触手の出現", description: "背中や体から触手がのたうち出る" },
  "extra-eyes": { label: "追加の目が開く", description: "顔や体に追加の目が開く" },
  "head-explode": { label: "頭部爆発", description: "頭部が爆発する（PG-13スタイル）" },
  "head-off": { label: "首が取れる", description: "頭が体から離れて浮遊する（PG-13）" },
  "spiders-from-mouth": { label: "口からクモ", description: "開いた口からクモが這い出る（ホラー）" },
  "skin-surge": { label: "皮膚のうねり", description: "皮膚の下を何かが動くようにうねる" },

  // ── Face-Expression ──
  "horror-face": { label: "ホラーフェイス", description: "顔がホラー表情に歪む" },
  "oni-mask": { label: "鬼の面", description: "鬼の仮面が顔の上に現れる" },
  "glowing-eyes": { label: "光る目", description: "目が内側から輝く" },
  "floral-eyes": { label: "花の目", description: "目のくぼみから花が咲く" },
  "bloom-mouth": { label: "花咲く口", description: "開いた口から花が咲き広がる" },
  "x-ray": { label: "X線透視", description: "体がX線スタイルで透けて骨格が見える" },
  "agent-snap": { label: "サングラス装着", description: "サングラスがパチンと目に現れる" },
  "visor-x": { label: "サイバーバイザー", description: "SF風サイバーバイザーが出現する" },

  // ── Aura-Ambient ──
  "paparazzi": { label: "パパラッチの閃光", description: "カメラフラッシュが周囲で弾ける" },
  "money-rain": { label: "お金の雨", description: "紙幣が降り注ぐ" },
  "color-rain": { label: "カラーレイン", description: "鮮やかな色の雨が降り注ぐ" },
  "saint-glow": { label: "聖人の光輪", description: "後光と神聖な光が輝く" },
  "fire-aura": { label: "炎のオーラ", description: "炎が体の周囲を舐め回す" },
  "frost-aura": { label: "冷気のオーラ", description: "周囲が凍りつくような冷気が放射される" },
  "shadow-aura": { label: "影のオーラ", description: "暗い影の触手が体の周囲をうねる" },
  "electricity-aura": { label: "電気のオーラ", description: "テスラコイル式の電気弧が体の周囲で弾ける" },
  "sparkles-around": { label: "魔法の輝き", description: "魔法の輝きが体の周囲を漂う" },
  "fairies-around": { label: "妖精たち", description: "小さな輝く妖精が体の周囲を飛び回る" },
  "objects-orbit": { label: "物体の周回", description: "小物体が体の周囲をゆっくり周回する" },
  "petals-around": { label: "花びら舞う", description: "桜の花びらが体の周囲に漂う" },
  "glow-trace": { label: "光の軌跡", description: "輝くトレイルが体の動きに追随する" },
  "tattoo-animation": { label: "タトゥーアニメーション", description: "肌のタトゥーが光り、動き始める" },
}

export default map
