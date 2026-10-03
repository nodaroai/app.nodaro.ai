import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Positive
  "happy": { label: "幸せ", description: "温かく微笑む幸せ" },
  "joyful": { label: "喜びにあふれた", description: "輝くような、抑えきれない喜び" },
  "serene": { label: "穏やか", description: "静かで平和な満足感" },
  "playful": { label: "遊び心のある", description: "いたずらっぽい遊び心のあるエネルギー" },
  "confident": { label: "自信に満ちた", description: "揺るぎない自信" },
  "loving": { label: "愛に満ちた", description: "優しく愛情深い" },
  "amused": { label: "面白がっている", description: "微妙に面白がってにやりとする" },
  "smirking": { label: "ニヤつく", description: "生意気で傲慢な笑み" },
  "eccentric": { label: "風変わり", description: "風変わりで型破り" },
  "hopeful": { label: "希望に満ちた", description: "目を輝かせ楽観的" },

  // Negative
  "sad": { label: "悲しい", description: "静かに悲しく、うつむきがち" },
  "angry": { label: "怒っている", description: "明確な怒り、緊張" },
  "afraid": { label: "怯えた", description: "怯えて目を見開く" },
  "anxious": { label: "不安", description: "そわそわして心配そう" },
  "melancholy": { label: "憂鬱", description: "切ない悲しみ" },
  "devastated": { label: "打ちひしがれた", description: "心が砕けるような悲しみ" },
  "grieving": { label: "悲嘆に暮れる", description: "深い悲しみ、喪失" },
  "caught-off-guard": { label: "不意を突かれた", description: "反応の途中で驚いた" },
  "aloof": { label: "よそよそしい", description: "打ち解けず、興味なさげ" },
  "vulnerable": { label: "傷つきやすい", description: "むき出しで無防備" },
  "coy": { label: "はにかみ", description: "恥ずかしげで伏し目がち" },
  "bored": { label: "退屈", description: "無関心で無表情" },
  "embarrassed": { label: "恥ずかしがった", description: "頬を赤らめ、目をそらす" },
  "disgusted": { label: "嫌悪", description: "嫌悪感、後ずさり" },
  "bewildered": { label: "困惑", description: "混乱して途方に暮れる" },

  // Neutral
  "thoughtful": { label: "思索的", description: "深く考えている" },
  "stoic": { label: "ポーカーフェイス", description: "無表情で読み取れない" },
  "calm": { label: "落ち着いた", description: "心の軸がぶれず、動じない" },
  "curious": { label: "好奇心旺盛", description: "興味津々で、注意を向けている" },
  "mysterious": { label: "ミステリアス", description: "底知れず、謎めいた" },
  "dazed": { label: "ぼんやり", description: "夢見心地で半分上の空" },
  "sleepy": { label: "眠そう", description: "うとうとして瞼が重い" },
  "unbothered": { label: "平然", description: "落ち着き払った余裕" },

  // Intense
  "fierce": { label: "猛々しい", description: "猛々しく堂々とした" },
  "determined": { label: "決意に満ちた", description: "毅然とした集中した意志" },
  "passionate": { label: "情熱的", description: "燃えるような情熱" },
  "brooding": { label: "陰鬱", description: "暗く思い詰めた憂鬱" },
  "seductive": { label: "誘惑的", description: "魅惑的で誘惑的" },
  "defiant": { label: "反抗的", description: "反抗的で屈しない" },
  "sultry": { label: "妖艶", description: "燻るような、重たげな瞼" },
  "smoldering": { label: "燻る", description: "張り詰めて、じわじわと燃える激しさ" },
  "sinister": { label: "邪悪", description: "暗く悪意あり、脅威的" },
  "wiccan-mystical": { label: "ウィッカン／神秘的", description: "静かに異世界的でオカルト的" },
  "lazy-shy": { label: "けだるげでシャイ", description: "うとうと、柔らかく半ばシャイ" },
  "awe": { label: "畏敬", description: "驚嘆、畏れに満ちた" },
  "shocked": { label: "ショック", description: "驚いて口を開ける" },

  // Additional moods
  "flirty": { label: "思わせぶり", description: "遊び心のある誘い、余韻の残る笑み、じっと合わせる視線" },
  "suspicious": { label: "疑い深い", description: "警戒した不信、細めた目、横目" },
  "resigned": { label: "諦念", description: "不快な状況を静かに受け入れる" },
  "conflicted": { label: "葛藤", description: "目に見える内的葛藤、寄せた眉" },
  "relieved": { label: "安堵", description: "緊張が解けて穏やかに" },
}

export default map
