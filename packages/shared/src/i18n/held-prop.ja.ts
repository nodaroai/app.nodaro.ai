import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Devices
  "smartphone": { label: "スマートフォン", description: "手に持ったモダンなスマホ" },
  "smartphone-raised": { label: "掲げたスマホ", description: "撮影中に掲げたスマホ" },
  "polaroid-camera": { label: "ポラロイドカメラ", description: "ヴィンテージのインスタントカメラ" },
  "vintage-camera": { label: "ヴィンテージカメラ", description: "ストラップ付きの古いフィルムカメラ" },
  "dslr-camera": { label: "デジタル一眼レフ", description: "モダンなDSLR／ミラーレスカメラ" },
  "video-camera": { label: "ビデオカメラ", description: "肩担ぎのビデオカメラ" },
  "microphone": { label: "マイク", description: "手持ちのボーカルマイク" },
  "megaphone": { label: "メガホン", description: "拡声器／メガホン" },
  "smartwatch": { label: "スマートウォッチ", description: "腕を持ち上げて時計を見る" },

  // Drinks
  "coffee-cup": { label: "コーヒーカップ", description: "陶器のコーヒーカップ" },
  "takeaway-coffee": { label: "テイクアウトのコーヒー", description: "紙のテイクアウト用コーヒーカップ" },
  "wine-glass": { label: "ワイングラス", description: "脚付きの赤ワイングラス" },
  "champagne-flute": { label: "シャンパンフルート", description: "高いシャンパンフルート" },
  "martini-glass": { label: "マティーニグラス", description: "クラシックなマティーニグラス" },
  "cocktail-glass": { label: "カクテルグラス", description: "カクテル入りのショートグラス" },
  "beer-bottle": { label: "ビール瓶", description: "茶色いビール瓶" },
  "water-bottle": { label: "水筒", description: "再利用可能な水筒" },

  // Smoking
  "cigarette": { label: "タバコ", description: "指の間に挟んだ火のついたタバコ" },
  "cigar": { label: "葉巻", description: "太く火のついた葉巻" },
  "vape-pen": { label: "ベイプペン", description: "細身のベイプペン" },
  "joint": { label: "ジョイント", description: "手巻きジョイント" },

  // Reading / Writing
  "book": { label: "本", description: "開いたハードカバーの本" },
  "magazine": { label: "雑誌", description: "光沢のある折り畳んだ雑誌" },
  "newspaper": { label: "新聞", description: "折り畳んだブロードシート新聞" },
  "notebook": { label: "ノート", description: "罫線入りの開いたノート" },
  "pen": { label: "ペン", description: "書きかけで構えたペン" },
  "marker": { label: "マーカー", description: "書きかけの太いマーカー" },
  "paintbrush": { label: "絵筆", description: "絵の具を含ませた筆" },
  "chalk": { label: "チョーク", description: "白いチョーク" },

  // Bags / Accessories
  "handbag": { label: "ハンドバッグ", description: "デザイナーズ・ハンドバッグ" },
  "tote-bag": { label: "トートバッグ", description: "柔らかなキャンバスのトート" },
  "briefcase": { label: "ブリーフケース", description: "硬質シェルのブリーフケース" },
  "umbrella": { label: "傘", description: "開いた黒い傘" },
  "fan-folding": { label: "扇子", description: "開いた手描きの扇子" },

  // Floral / Nature
  "bouquet": { label: "花束", description: "色とりどりの花の花束" },
  "single-rose": { label: "1本のバラ", description: "長い茎の1本のバラ" },
  "sunflower": { label: "ヒマワリ", description: "1本の高いヒマワリ" },
  "leaf": { label: "葉", description: "1枚の大きな葉" },
  "fruit-apple": { label: "リンゴ", description: "1個の新鮮なリンゴ" },

  // Instruments
  "guitar": { label: "ギター", description: "体に掛けたギター" },
  "violin": { label: "バイオリン", description: "顎の下に構えたバイオリン" },
  "saxophone": { label: "サックス", description: "唇に当てたサックス" },
  "drumsticks": { label: "ドラムスティック", description: "交差させた一対のドラムスティック" },
  "sheet-music": { label: "楽譜", description: "折り畳んだ楽譜" },

  // Companion
  "small-dog": { label: "小型犬", description: "腕に抱いた小型犬" },
  "cat": { label: "猫", description: "腕に乗せた猫" },
  "plush-toy": { label: "ぬいぐるみ", description: "抱きしめた柔らかなぬいぐるみ" },

  // Occupational / Weapon
  "katana": { label: "刀", description: "日本の片刃の刀" },
  "pointer-stick": { label: "指示棒", description: "伸縮式の指示棒" },
  "gavel": { label: "ガベル（小槌）", description: "木製の司法用ガベル" },
  "wine-bottle": { label: "ワインボトル", description: "ホイル封のついた未開封のボトル" },

  // Additional held props
  "parasol": { label: "パラソル", description: "陽射しを遮る装飾的なパラソル" },
  "locket": { label: "ロケット", description: "指で開いたヴィンテージのロケットペンダント" },
  "lighter": { label: "ライター", description: "炎に親指を添えたクロームのライター" },
  "lantern": { label: "ランタン", description: "暖かな琥珀色に灯るヴィンテージの手持ちランタン" },
  "flashlight": { label: "懐中電灯", description: "モダンな懐中電灯の光線、探検／ミステリー" },
  "compass": { label: "コンパス", description: "手持ちの航海用コンパス、探検" },
  "bow-and-arrow": { label: "弓矢", description: "矢をつがえて引き絞った弓" },
  "shield": { label: "盾", description: "手持ちの盾、中世／ファンタジー" },
}

export default map
