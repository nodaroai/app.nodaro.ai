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
  "steven-meisel": { description: "磨かれたミッドセンチュリーのエディトリアル" },
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
  "robert-capa": { description: "生々しい戦闘フォトジャーナリズム" },
  "sebastiao-salgado": { description: "壮大なモノクロームの社会派ドキュメンタリー" },
  "diane-arbus": { description: "厳しく対峙的なポートレート" },

  // Cinematographers
  "roger-deakins": { description: "絵画的なシネマティック・ナチュラリズム" },
  "emmanuel-lubezki": { description: "浮遊する自然光の撮影" },
  "greig-fraser": { description: "豊かで触覚的なジャンルシネマトグラフィー" },
  "christopher-doyle": { description: "彩度の高い手持ちネオン・ムード" },

  // Concept
  "greg-rutkowski": { description: "壮大な絵画的ファンタジーのコンセプトアート" },
  "magali-villeneuve": { description: "ヒロイックなファンタジーのキャラクターアート" },
  "charlie-bowater": { description: "雰囲気のあるデジタル・ポートレート" },
  "sam-spratt": { description: "寓意的でハイパーリアルなポートレート" },
  "ruan-jia": { description: "豊かで絵画的なファンタジー・ポートレート" },
  "ilya-kuvshinov": { description: "アニメ的な様式化ポートレート" },
  "wlop": { description: "幻想的で絵画的なファンタジー" },
  "artgerm": { description: "コミック風の磨かれたピンナップ" },

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
  "guido-van-helten": { description: "壮大な壁画家のポートレート" },

  // Additional photographers
  "mapplethorpe": { description: "白黒のスタジオ・ポートレート、古典的なヌードと花" },
  "sherman": { description: "コンセプチュアルな自画像とキャラクター・スタディ" },
  "crewdson": { description: "シネマティックな郊外と不穏な雰囲気" },
  "lachapelle": { description: "シュルレアリスト的なセレブと彩度の高いキャンプ" },
  "klein": { description: "ハイファッションのエッジ、ドラマチックな影の照明" },
  "lindbergh": { description: "ミニマリストの白黒ファッション、生々しい美" },
  "tillmans": { description: "コンテンポラリーなキャンディッド、クィアな親密さ" },
  "teller": { description: "カジュアルなフラッシュ・ファッション、アンチ・グラマー" },
  "penn": { description: "ミッドセンチュリーのスタジオ・ポートレート、ファッションと静物" },
}

export default map
