import type { LocaleCatalogMap } from "./types.js"

// Per project rule: omit all labels for photographer (keep canonical Latin names);
// translate descriptions only.
const map: LocaleCatalogMap = {
  // Editorial
  "tim-walker": { description: "絵画的でおとぎ話のようなファッション" },
  "paolo-roversi": { description: "柔らかく幻想的なポラロイドの輝き" },
  "marta-bevacqua": { description: "夢のように絵画的なポートレート" },
  "patrick-demarchelier": { description: "洗練されたクラシックなファッションポートレート" },
  "nick-knight": { description: "高光沢のアヴァンギャルドなファッション" },
  "mario-testino": { description: "魅惑的で陽光に満ちたファッション" },
  "steven-meisel": { description: "洗練されたミッドセンチュリーのエディトリアル" },
  "helmut-newton": { description: "大胆な白黒の挑発" },
  "mario-sorrenti": { description: "親密で粒状感のあるファッション" },
  "annie-leibovitz": { description: "シネマティックなセレブリティ・ポートレート" },
  "felicia-simion": { description: "シュルレアリスティックな田園風ファインアート" },
  "oleg-oprisco": { description: "シネマティックなフィルム粒状感のストーリーテリング" },
  "bella-kotak": { description: "魔法のようなファンタジー民話風ポートレート" },
  "yigal-ozeri": { description: "ハイパーリアルなペイント風ポートレート" },
  "jimmy-marble": { description: "パステル調でキャンディのように明るいエディトリアル" },
  "rinko-kawauchi": { description: "静かで光に満ちた日常" },
  "ellen-von-unwerth": { description: "遊び心あるレトロなピンナップのエネルギー" },

  // Documentary
  "henri-cartier-bresson": { description: "決定的瞬間のストリート写真" },
  "vivian-maier": { description: "ミッドセンチュリーのアメリカン・ストリート" },
  "saul-leiter": { description: "ガラス越しの絵画的カラー・ストリート" },
  "daido-moriyama": { description: "粒状感のある高コントラストの東京ストリート" },
  "robert-capa": { description: "生々しい戦場のフォトジャーナリズム" },
  "sebastiao-salgado": { description: "壮大なモノクロームの社会派ドキュメンタリー" },
  "diane-arbus": { description: "厳しく対峙的なポートレート" },

  // Cinematographers
  "roger-deakins": { description: "絵画的なシネマティック・ナチュラリズム" },
  "emmanuel-lubezki": { description: "浮遊感のあるカメラワークと自然光の撮影" },
  "greig-fraser": { description: "豊かで質感あふれるジャンル映画の撮影" },
  "christopher-doyle": { description: "彩度の高い手持ちネオン・ムード" },

  // Concept
  "greg-rutkowski": { description: "壮大な絵画的ファンタジーのコンセプトアート" },
  "magali-villeneuve": { description: "ヒロイックなファンタジーのキャラクターアート" },
  "charlie-bowater": { description: "雰囲気のあるデジタル・ポートレート" },
  "sam-spratt": { description: "寓意的でハイパーリアルなポートレート" },
  "ruan-jia": { description: "豊かで絵画的なファンタジー・ポートレート" },
  "ilya-kuvshinov": { description: "アニメ的な様式化ポートレート" },
  "wlop": { description: "幻想的で絵画的なファンタジー" },
  "artgerm": { description: "完成度の高いコミック風ピンナップ" },

  // Illustrators
  "makoto-shinkai": { description: "シネマティックなアニメの空と光" },
  "studio-ghibli": { description: "手描きのジブリの温かさ" },
  "alphonse-mucha": { description: "アール・ヌーヴォーの装飾パネル" },
  "carne-griffiths": { description: "インクのにじみがある植物的ポートレート" },
  "conrad-roset": { description: "穏やかな水彩の人物表現" },
  "akihito-yoshida": { description: "静かなインクと粒子のモノクローム" },
  "karol-bak": { description: "象徴主義のペイントされたミューズ" },
  "ismail-inceoglu": { description: "神話的で絵画的な風景" },
  "stefan-gesell": { description: "暗くシュルレアリスティックなポートレート" },
  "andrew-atroshenko": { description: "ロマンチックな印象派の人物画" },
  "peter-gric": { description: "建築的シュルレアリスティックな風景" },
  "ingrid-baars": { description: "彫刻的なファッション・アート・コラージュ" },
  "guido-van-helten": { description: "巨大壁画によるモニュメンタルなポートレート" },

  // Additional photographers
  "mapplethorpe": { description: "形式美を追求した白黒のスタジオヌードと花" },
  "sherman": { description: "コンセプチュアルな自画像とキャラクター・スタディ" },
  "crewdson": { description: "シネマティックな郊外と不穏な雰囲気" },
  "lachapelle": { description: "シュールで極彩色な、キッチュで過剰なセレブ写真" },
  "klein": { description: "硬質なグラマーと、抑制された攻撃性" },
  "lindbergh": { description: "ミニマルな白黒、自然光のファッション写真" },
  "tillmans": { description: "キャンディッドなクィアの親密さと、気取らないフラッシュ" },
  "teller": { description: "アンチ・グラマーな直射フラッシュのスナップ" },
  "penn": { description: "簡素で厳格なミッドセンチュリーのスタジオ・ポートレート" },

  // Additional photographers
  "mcginley": { description: "風景の中の自然主義的な若者とヌード、太陽光のフレアの効いたキャンディッド" },
  "mitchell": { description: "コンテンポラリーな黒人ポートレート、柔らかな自然光、ファッションとドキュメンタリーの融合" },
  "collins": { description: "ピンクを強調した夢のような女性目線のファッション、霞んだ35mm" },
  "weston": { description: "モダニズムの白黒静物、彫刻的なヌード、シャープな形式美" },
  "beaton": { description: "クラシックなハリウッド時代のポートレート、演劇的な演出、豪華な背景" },
}

export default map
