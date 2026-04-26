import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Fabric
  "silk": { label: "シルク", description: "滑らかで光沢のあるシルク" },
  "cotton": { label: "コットン", description: "柔らかなマットコットン" },
  "denim": { label: "デニム", description: "厚いインディゴデニム" },
  "leather": { label: "レザー", description: "豊かでしなやかな革" },
  "velvet": { label: "ベルベット", description: "ふっくらとしたベルベット" },
  "satin": { label: "サテン", description: "光沢のあるサテン" },
  "lace": { label: "レース", description: "繊細な模様のレース" },
  "wool": { label: "ウール", description: "暖かく織られたウール" },
  "linen": { label: "リネン", description: "自然な質感のリネン" },
  "tweed": { label: "ツイード", description: "素朴に織られたツイード" },
  "cashmere": { label: "カシミア", description: "贅沢に柔らかいカシミア" },
  "chiffon": { label: "シフォン", description: "透け感のある流れるシフォン" },
  "fur": { label: "毛皮", description: "厚いふっくらとした毛皮" },

  // Metal
  "gold": { label: "ゴールド", description: "磨かれた金" },
  "silver": { label: "シルバー", description: "磨かれた銀" },
  "bronze": { label: "ブロンズ", description: "緑青のついた鋳造ブロンズ" },
  "chrome": { label: "クローム", description: "極めて反射するクローム" },
  "copper": { label: "銅", description: "緑青のある暖かな銅" },
  "brass": { label: "真鍮", description: "アンティーク真鍮" },
  "steel": { label: "スチール", description: "ヘアライン仕上げのステンレス鋼" },
  "iron": { label: "鉄", description: "粗い錬鉄" },
  "platinum": { label: "プラチナ", description: "光沢のあるプラチナ" },
  "titanium": { label: "チタン", description: "マットな工業用チタン" },

  // Stone
  "marble": { label: "大理石", description: "脈のある白い大理石" },
  "granite": { label: "御影石", description: "斑点のある磨かれた御影石" },
  "obsidian": { label: "黒曜石", description: "光沢のある黒い黒曜石" },
  "sandstone": { label: "砂岩", description: "暖かく層状の砂岩" },
  "slate": { label: "粘板岩", description: "暗く平らな粘板岩" },
  "jade": { label: "翡翠", description: "半透明の緑の翡翠" },
  "onyx": { label: "オニキス", description: "縞模様の磨かれたオニキス" },
  "concrete": { label: "コンクリート", description: "鋳造された工業用コンクリート" },

  // Wood
  "oak": { label: "オーク", description: "豊かな木目のオーク" },
  "mahogany": { label: "マホガニー", description: "深い赤色のマホガニー" },
  "walnut": { label: "ウォルナット", description: "暗いウォルナット" },
  "bamboo": { label: "竹", description: "節のある明るい竹" },
  "birch": { label: "白樺", description: "淡く滑らかな白樺" },
  "driftwood": { label: "流木", description: "風化した流木" },

  // Glass / Ceramic
  "glass": { label: "ガラス", description: "透明なガラス" },
  "stained-glass": { label: "ステンドグラス", description: "宝石色のステンドグラス" },
  "crystal": { label: "クリスタル", description: "ファセット加工された透明クリスタル" },
  "porcelain": { label: "磁器", description: "滑らかな白い磁器" },
  "ceramic-glazed": { label: "釉薬陶器", description: "土色の釉薬陶器" },
  "terracotta": { label: "テラコッタ", description: "暖かな素焼きのテラコッタ" },

  // Natural
  "water": { label: "水", description: "流れる半透明の水" },
  "fire": { label: "炎", description: "生きた炎" },
  "ice": { label: "氷", description: "半透明の結晶氷" },
  "smoke": { label: "煙", description: "漂う幻想的な煙" },
  "sand": { label: "砂", description: "細かい粒状の砂" },
  "moss": { label: "苔", description: "瑞々しく生きた苔" },
  "leaves": { label: "葉", description: "層になった植物の葉" },

  // Exotic
  "holographic": { label: "ホログラフィック", description: "虹色のホログラム" },
  "liquid-metal": { label: "リキッドメタル", description: "反射する液体クローム" },
  "neon": { label: "ネオングロー", description: "輝くネオン管" },
  "translucent": { label: "半透明レジン", description: "曇りガラス調の輝くレジン" },
  "mirror": { label: "鏡面", description: "完璧な鏡面" },
  "plasma": { label: "プラズマ", description: "輝く電気プラズマ" },
  "crystal-shard": { label: "クリスタルの破片", description: "輝く砕けたクリスタル" },
  "obsidian-glass": { label: "黒曜石ガラス", description: "暗い火山ガラス" },

  // Additional materials
  "suede": { label: "スエード", description: "起毛した柔らかなレザー、マットでベルベットのような表面" },
  "mesh": { label: "メッシュ", description: "透けるネット生地、アスレチック／シアートップ風" },
  "patent-leather": { label: "エナメルレザー", description: "高光沢で反射するエナメル革" },
  "terrazzo": { label: "テラゾー", description: "大理石やガラスの粒を埋め込んだ複合石材" },
  "iridescent": { label: "イリディセント", description: "色が変化する虹色の表面" },
  "mother-of-pearl": { label: "マザー・オブ・パール", description: "貝の内側の真珠光沢、虹色のクリーム色" },
  "carbon-fiber": { label: "カーボンファイバー", description: "織られた黒いカーボン繊維の複合材" },
  "holographic-film": { label: "ホログラフィックフィルム", description: "光を屈折させるホログラム、虹色の輝き" },
}

export default map
