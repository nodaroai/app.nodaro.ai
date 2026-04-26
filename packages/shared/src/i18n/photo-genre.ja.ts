import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Editorial
  "fashion-editorial": { label: "ファッション・エディトリアル", description: "ハイファッション雑誌の見開き" },
  "vogue-editorial": { label: "Vogue エディトリアル", description: "Vogue風カバーエディトリアル" },
  "magazine-cover": { label: "雑誌の表紙", description: "タイトに切り取られた表紙構図" },
  "lookbook": { label: "ルックブック", description: "クリーンなルックブックの衣装ショット" },
  "ecommerce-flatlay": { label: "EC向けフラットレイ", description: "俯瞰の商品フラットレイ" },
  "beauty-editorial": { label: "ビューティ・エディトリアル", description: "マクロのビューティ／スキンケア・クローズアップ" },
  "campaign-advertising": { label: "キャンペーン／広告", description: "磨かれたブランドキャンペーン画像" },

  // Brand / Editorial Reference — keep brand names mostly English
  "brand-vogue": { label: "Vogue シグネチャー", description: "Vogueのエディトリアル・シグネチャー" },
  "brand-dior": { label: "Dior シグネチャー", description: "Dior エディトリアル — キアロスクーロとシルエット" },
  "brand-jil-sander": { label: "Jil Sander ミニマリズム", description: "Jil Sander — ミニマルで建築的、ミュート" },
  "brand-vivienne-tam": { label: "Vivienne Tam スタイル", description: "Vivienne Tam — オリエンタリストの装飾的ファッション" },
  "brand-jacquemus": { label: "Jacquemus スタイル", description: "Jacquemus — 陽光に満ちたシュルレアリスト的で遊び心" },
  "brand-helmut-newton": { label: "Helmut Newton スタイル", description: "Helmut Newton — 高コントラストの白黒で挑発的" },
  "brand-harpers-bazaar": { label: "Harper's Bazaar スタイル", description: "Harper's Bazaar — ハイファッションでグロッシー" },

  // Documentary
  "paparazzi": { label: "パパラッチ", description: "フラッシュで白飛びしたタブロイドのキャンディッド" },
  "street-photography": { label: "ストリートフォト", description: "ポーズなしの都会のストリートフレーム" },
  "candid-journalism": { label: "キャンディッド・ジャーナリズム", description: "ポーズなしのフォトジャーナリスト的瞬間" },
  "photojournalism": { label: "フォトジャーナリズム", description: "エディトリアル級のニュース報道" },
  "documentary": { label: "ドキュメンタリー", description: "長期取材のドキュメンタリー・ポートレート" },
  "snapshot": { label: "スナップショット", description: "カジュアルなアマチュア・スナップショット" },

  // Studio / Formal
  "corporate-headshot": { label: "コーポレート・ヘッドショット", description: "LinkedIn風のヘッドショット" },
  "personal-branding": { label: "パーソナル・ブランディング", description: "モダンなパーソナルブランド・ポートレート" },
  "yearbook": { label: "イヤーブック", description: "学校の卒業アルバム風ポートレート" },
  "id-passport": { label: "ID／パスポート", description: "規格に沿ったパスポート写真" },
  "mugshot": { label: "マグショット", description: "警察の身元記録風ポートレート" },
  "wedding-portrait": { label: "ウェディング・ポートレート", description: "ロマンチックなブライダル風ポートレート" },
  "family-portrait": { label: "ファミリー・ポートレート", description: "ポーズを取った家族集合写真" },
  "glamour-portrait": { label: "グラマー・ポートレート", description: "ソフトフォーカスのグラマー・ポートレート" },
  "film-noir": { label: "フィルム・ノワール", description: "ハードシャドウのノワール・ポートレート" },

  // Selfie
  "mirror-selfie": { label: "ミラー自撮り", description: "鏡越しに全身が映るスマホ自撮り" },
  "gym-mirror-selfie": { label: "ジムのミラー自撮り", description: "ロッカールームのジム鏡自撮り" },
  "front-cam-selfie": { label: "フロントカメラ自撮り", description: "腕を伸ばしたフロントカメラ自撮り" },
  "bathroom-mirror-selfie": { label: "バスルームのミラー自撮り", description: "フラッシュ付きバスルーム鏡自撮り" },
  "bereal-dual": { label: "BeReal デュアル", description: "前面＋背面の同時2画面" },
  "flip-cam-selfie": { label: "フリップカム自撮り", description: "偶然撮れた低画質のフリップカム" },
  "group-selfie": { label: "グループ自撮り", description: "複数人のスマホ自撮り" },
  "lofi-baddie-selfie": { label: "ローファイ2010s自撮り", description: "初期iPhoneの低光量自撮り" },

  // Print / Context
  "album-cover": { label: "アルバムカバー", description: "正方形のアルバムカバー構図" },
  "movie-poster": { label: "映画ポスター", description: "シネマ的な劇場用ポスター" },
  "advertising": { label: "広告", description: "光沢のある広告キャンペーン写真" },
  "food-photography": { label: "フードフォトグラフィ", description: "俯瞰または45度角のフードショット" },
  "real-estate": { label: "不動産", description: "建築的に広い室内ショット" },
  "sports-action": { label: "スポーツアクション", description: "望遠で凍ったスポーツの瞬間" },

  // Additional genres
  "point-and-shoot": { label: "ポイント＆シュート／使い捨てカメラ", description: "使い捨てカメラ風の美学、強いフラッシュ、カジュアル" },
  "lifestyle-blog": { label: "ライフスタイルブログ", description: "柔らかな自然光のホーム／コーヒーブロガー風" },
  "product-shot": { label: "プロダクトショット", description: "ニュートラル背景にクリーンに切り抜かれた商品、EC向け" },
}

export default map
