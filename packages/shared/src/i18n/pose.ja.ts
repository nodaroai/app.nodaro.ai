import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Standing
  "standing-upright": { label: "直立", description: "リラックスした立ち姿勢" },
  "confident-stance": { label: "自信に満ちた構え", description: "足を開き、肩を引いた姿勢" },
  "hands-on-hips": { label: "腰に手", description: "腰に手を当てる" },
  "arms-crossed": { label: "腕組み", description: "胸の前で腕を組む" },
  "leaning": { label: "もたれる", description: "何かにもたれかかる" },
  "hero-pose": { label: "ヒーローポーズ", description: "劇的で英雄的な構え" },
  "contrapposto": { label: "コントラポスト", description: "腰を傾け、片脚に体重を乗せる" },
  "leaning-against-wall": { label: "壁にもたれる", description: "壁にカジュアルにもたれる" },
  "hands-behind-head": { label: "頭の後ろで手", description: "両手を頭の後ろで組む" },
  "hands-behind-back": { label: "背中で手", description: "両手を背中で組む" },

  // Seated
  "sitting": { label: "座る", description: "自然に座る" },
  "cross-legged": { label: "あぐら", description: "床にあぐらをかいて座る" },
  "kneeling": { label: "膝立ち", description: "膝をついて座る" },
  "crouching": { label: "しゃがむ", description: "低くしゃがむ" },
  "lounging": { label: "ラウンジング", description: "リラックスして寄りかかる座り方" },
  "sitting-edge-of-bed": { label: "ベッドの端に座る", description: "ベッドの端に腰掛ける" },
  "chair-arm-drape": { label: "椅子の肘掛けに脚を投げ出す", description: "椅子の肘掛けに脚を投げかける" },
  "elbow-propped": { label: "肘で頬を支える", description: "肘で頬を支える" },
  "lying-on-stomach-reading": { label: "うつ伏せで読書", description: "うつ伏せで肘をつき読書" },

  // Movement
  "walking": { label: "歩く", description: "歩いている途中" },
  "running": { label: "走る", description: "走っている途中、動きの中で" },
  "jumping": { label: "ジャンプ", description: "宙に浮いた、ジャンプの途中" },
  "dancing": { label: "踊る", description: "踊っている途中" },
  "climbing": { label: "登る", description: "登っている、上方を掴む" },
  "mid-fall": { label: "落下中", description: "宙を落下する途中" },
  "mid-spin": { label: "回転中", description: "くるくる回転する途中" },
  "stretching": { label: "ストレッチ", description: "全身を伸ばすストレッチ、両腕を頭上に" },
  "reaching-up": { label: "上に手を伸ばす", description: "両腕を頭上に伸ばす" },
  "kissing": { label: "キス", description: "キスをしている" },
  "riding": { label: "乗る", description: "自転車、馬、バイクに乗る" },
  "driving": { label: "運転", description: "車のハンドルを握る" },

  // Action
  "fighting-stance": { label: "戦闘姿勢", description: "戦闘準備の構え" },
  "reaching": { label: "手を伸ばす", description: "外側へ手を伸ばす" },
  "throwing": { label: "投げる", description: "投げる動作の途中" },
  "leaping": { label: "跳ぶ", description: "ダイナミックに前へ跳ぶ" },
  "dramatic-action": { label: "劇的なアクション", description: "誇張されたアクションポーズ" },
  "biting-lip": { label: "唇を噛む", description: "わずかに遊び心ある唇噛み" },
  "mid-laugh": { label: "笑いの途中", description: "頭を後ろに笑っている途中" },
  "pointing-at-camera": { label: "カメラを指差す", description: "カメラに向かって指差す" },
  "tongue-out": { label: "舌を出す", description: "遊び心ある舌出し表情" },
  "thinking": { label: "考える", description: "顎に手、思案中" },

  // Resting
  "lying-down": { label: "横たわる", description: "平らに横たわる" },
  "sleeping": { label: "眠る", description: "目を閉じて眠る" },
  "hugging": { label: "ハグ", description: "他の人を抱きしめる" },
  "looking-away": { label: "視線をそらす", description: "頭を向け、視線をそらす" },
  "looking-up": { label: "上を見る", description: "空を見上げる" },
  "looking-down": { label: "下を見る", description: "目を伏せる" },
  "head-over-shoulder": { label: "肩越しに振り返る", description: "肩越しに振り返って見る" },
  "wading-in-water": { label: "水中を歩く", description: "太もも中ほどまで水に浸かって歩く" },

  // Hand position
  "hands-in-pockets": { label: "ポケットに手", description: "両手をポケットに入れる" },
  "hand-on-hip": { label: "腰に片手", description: "片手を腰に当てる" },
  "hand-position-hands-on-hips": { label: "両手を腰に", description: "両手を腰に当てる" },
  "hand-on-chin": { label: "顎に手", description: "顎の下に手を添える" },
  "hand-on-collarbone": { label: "鎖骨に手", description: "鎖骨に手を添える" },
  "hand-brushing-hair": { label: "髪に手を通す", description: "髪に手を通す" },
  "finger-to-lip": { label: "指を唇に", description: "指先を下唇に押し当てる" },
  "arms-wrapped-around-self": { label: "自分を抱きしめる", description: "腕を胴体に巻き付ける自己ハグ" },
  "hands-clasped": { label: "手を組む", description: "両手を前で組む" },

  // Body lean
  "leaning-back": { label: "後ろにもたれる", description: "胴がわずかに後ろに傾く" },
  "leaning-forward": { label: "前に身を乗り出す", description: "胴がカメラへ前傾する" },
  "body-lean-contrapposto": { label: "コントラポスト", description: "片脚に体重、片方の腰を突き出す" },
  "arched-back": { label: "背中をそらす", description: "背中を緩やかにそらし、胸を前へ" },
  "shoulder-rolled-forward": { label: "片肩を前に丸める", description: "片方の肩を前に丸める" },

  // Head tilt
  "tilted-up": { label: "上向き", description: "頭をわずかに上に傾ける" },
  "tilted-down": { label: "下向き", description: "頭をわずかに下に傾ける" },
  "tilted-side": { label: "横傾け", description: "頭を片方の肩に傾ける" },
  "tilted-back": { label: "後ろ向き", description: "頭を完全に後ろへ、喉を露わに" },
  "chin-up": { label: "顎を上げる", description: "顎を上げ、鼻先を見下ろす" },
  "chin-tucked": { label: "顎を引く", description: "顎を胸へ引く" },

  // Activity
  "activity-smoking": { label: "喫煙", description: "タバコを持って吸う" },
  "activity-drinking": { label: "飲む", description: "グラスやカップから飲む" },
  "activity-eating": { label: "食べる", description: "一口食べる途中" },
  "activity-talking-on-phone": { label: "電話で話す", description: "耳に当てた電話で話す" },
  "activity-texting": { label: "テキストを打つ", description: "下を見て電話、親指でタイピング" },
  "activity-typing-laptop": { label: "ノートPCで打つ", description: "キーボードに手、画面に集中" },
  "activity-reading": { label: "読書", description: "本や雑誌を開いて持つ" },
  "activity-writing": { label: "書く", description: "ノートにペンで書く" },
  "activity-painting": { label: "絵を描く", description: "キャンバスに筆で描く" },
  "activity-playing-instrument": { label: "楽器を演奏", description: "楽器を演奏している" },
  "activity-cooking": { label: "料理", description: "キッチンカウンターまたはコンロで料理" },
  "activity-driving": { label: "運転", description: "ハンドルを握る、運転中" },
}

export default map
