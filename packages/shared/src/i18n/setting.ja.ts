import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Indoor
  "coffee-shop": { label: "コーヒーショップ", description: "居心地のよいカフェの内装" },
  "library": { label: "図書館", description: "高い書架のある荘厳な図書館" },
  "office": { label: "モダンなオフィス", description: "明るくガラスの多いモダンなオフィス" },
  "home-office": { label: "ホームオフィス", description: "居心地のよい自宅のワークスペース" },
  "bedroom": { label: "寝室", description: "親密な寝室" },
  "living-room": { label: "リビングルーム", description: "居心地のよい住宅のリビングルーム" },
  "kitchen": { label: "キッチン", description: "朝の光が差し込む暖かな家庭のキッチン" },
  "hotel-room": { label: "ホテルの部屋", description: "市街の眺めが広がるエレガントなホテルの部屋" },
  "restaurant": { label: "レストラン", description: "親密なキャンドル灯のレストラン" },
  "nightclub": { label: "ナイトクラブ", description: "レーザーと煙のある暗いクラブ" },
  "gym": { label: "ジム", description: "モダンなフィットネスジム" },
  "classroom": { label: "教室", description: "明るい学校の教室" },
  "hospital": { label: "病院", description: "清潔な病院の廊下" },
  "laboratory": { label: "実験室", description: "発光する装置のある研究ラボ" },
  "courtroom": { label: "法廷", description: "木目パネル張りの法廷" },
  "warehouse": { label: "工業倉庫", description: "天窓のある広大な倉庫" },
  "subway-car": { label: "地下鉄車両", description: "走行中の地下鉄の車内" },
  "taxi": { label: "タクシー車内", description: "夜の市街タクシーの後部座席" },
  "cathedral": { label: "大聖堂", description: "ゴシック様式の大聖堂の内部" },
  "art-gallery": { label: "アートギャラリー", description: "ミニマリストのホワイトキューブ・ギャラリー" },

  // Urban
  "city-street": { label: "市街の通り", description: "賑やかな市街の通り" },
  "rooftop": { label: "屋上", description: "スカイラインを見渡す屋上テラス" },
  "back-alley": { label: "裏通り", description: "ざらついた狭い路地" },
  "neon-alley": { label: "ネオンの路地", description: "雨に濡れたネオンの路地" },
  "park": { label: "都市公園", description: "小道のある緑豊かな都市公園" },
  "backyard": { label: "裏庭のパティオ", description: "ストリングライトが灯る裏庭のデッキ" },
  "highway": { label: "開けた高速道路", description: "地平線まで伸びる高速道路" },
  "bridge": { label: "吊り橋", description: "水面を渡る長い吊り橋" },
  "train-station": { label: "駅", description: "停車中の列車があるホーム" },
  "airport": { label: "空港ターミナル", description: "湾曲したガラスの広大なターミナル" },
  "parking-lot": { label: "駐車場", description: "夕暮れの郊外の駐車場" },
  "penthouse": { label: "ペントハウス", description: "スカイラインの眺めがある豪華なペントハウス" },
  "gas-station": { label: "ガソリンスタンド", description: "夜の寂しい高速道路沿いのガソリンスタンド" },

  // Nature
  "forest": { label: "森の空き地", description: "陽光に照らされた苔むす空き地" },
  "beach": { label: "ビーチ", description: "波の打ち寄せる広い砂浜" },
  "mountain-peak": { label: "山頂", description: "岩の多いアルプスの山頂" },
  "desert": { label: "砂漠の砂丘", description: "風が吹き抜ける砂漠の砂丘" },
  "jungle": { label: "ジャングル", description: "湿った密林の内部" },
  "grassland": { label: "草原", description: "風が吹き抜ける開けた草原" },
  "snowy-tundra": { label: "雪のツンドラ", description: "風で削られた凍ったツンドラ" },
  "lake-shore": { label: "湖畔", description: "静かな山の湖の岸辺" },
  "riverbank": { label: "川岸", description: "柳の木が並ぶ蛇行する川岸" },
  "waterfall": { label: "滝", description: "苔むす崖を流れ落ちる滝" },
  "cave": { label: "洞窟", description: "陽光の差し込む岩の洞窟" },
  "western-canyon": { label: "西部の峡谷", description: "蛇行する川のある赤岩のメサ" },

  // Fantastical
  "alien-planet": { label: "異星の惑星", description: "二重の月がある異世界の風景" },
  "spaceship-interior": { label: "宇宙船の内部", description: "洗練された宇宙船の通路" },
  "underwater": { label: "水中", description: "陽光の差し込む深海の情景" },
  "fantasy-castle": { label: "ファンタジー城", description: "広大な城の中庭" },
  "medieval-village": { label: "中世の村", description: "石畳の村の広場" },
  "ancient-ruins": { label: "古代の遺跡", description: "蔓に覆われた石の遺跡" },
  "cyberpunk-city": { label: "サイバーパンクの都市", description: "ネオンが広がる巨大都市のスカイライン" },
  "haunted-mansion": { label: "幽霊屋敷", description: "朽ちかけたゴシックの邸宅" },
  "dreamscape": { label: "夢の景色", description: "シュルレアリスティックな浮遊する島々" },
  "wasteland": { label: "ポストアポカリプスの荒野", description: "錆びついた曇り空の荒野" },

  // Additional indoor / urban / mixed
  "balcony": { label: "バルコニー", description: "アパート／ホテルのバルコニー、街の眺め、親密な雰囲気" },
  "attic": { label: "屋根裏部屋", description: "木の梁が露わな埃っぽい屋根裏、傾斜した屋根" },
  "basement": { label: "地下室", description: "コンクリートの地下室、剥き出しの配管、薄暗い工業的雰囲気" },
  "sauna": { label: "サウナ", description: "木目パネル張りのサウナ、蒸気、親密で暖かな空間" },
  "dorm-room": { label: "寮の部屋", description: "大学の寮、シングルベッド、ポスター、フェアリーライト" },
  "locker-room": { label: "ロッカールーム", description: "ジム／スポーツ用ロッカールーム、タイル、ベンチ、鏡" },
  "music-studio": { label: "音楽スタジオ", description: "レコーディングスタジオ、マイク、防音材、ミキシングコンソール" },
  "conservatory": { label: "コンサバトリー（温室）", description: "ガラス張りの温室、熱帯植物、漉した光" },
}

export default map
