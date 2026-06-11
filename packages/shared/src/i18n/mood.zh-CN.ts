import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Positive --------------------
  "happy":     { label: "开心",       description: "温暖、带笑意的开心" },
  "joyful":    { label: "欣喜",       description: "灿烂、不加掩饰的喜悦" },
  "serene":    { label: "宁静",       description: "平和、安详的满足" },
  "playful":   { label: "顽皮",       description: "调皮、玩闹的能量" },
  "confident": { label: "自信",       description: "坚定、自信" },
  "loving":    { label: "深情",       description: "温柔、充满爱意" },
  "amused":    { label: "暗自好笑",   description: "微微好笑、嘴角上扬" },
  "smirking":  { label: "斜笑",       description: "傲慢自负的好笑" },
  "eccentric": { label: "古怪",       description: "古怪、不落俗套" },
  "hopeful":   { label: "充满希望",   description: "眼神明亮、乐观" },

  // -------------------- Negative --------------------
  "sad":         { label: "悲伤",       description: "安静地悲伤、目光低垂" },
  "angry":       { label: "愤怒",       description: "明显的愤怒与紧绷" },
  "afraid":      { label: "恐惧",       description: "受惊、瞪大眼睛" },
  "anxious":     { label: "焦虑",       description: "紧张、忧虑" },
  "melancholy":  { label: "忧郁",       description: "怅惘的悲伤" },
  "devastated":  { label: "心碎",       description: "心碎欲绝的悲恸" },
  "grieving":    { label: "悲恸",       description: "深切的悲恸与失去感" },
  "caught-off-guard":{ label: "措手不及", description: "反应一半时的惊愕" },
  "aloof":       { label: "疏离",       description: "退避、毫无兴趣" },
  "vulnerable":  { label: "脆弱",       description: "暴露、毫无防备" },
  "coy":         { label: "腼腆",       description: "羞怯、目光低垂" },
  "bored":       { label: "无聊",       description: "毫无兴趣、面无表情" },
  "embarrassed": { label: "尴尬",       description: "脸红、目光躲闪" },
  "disgusted":   { label: "厌恶",       description: "嫌恶、向后退缩" },
  "bewildered":  { label: "困惑",       description: "迷茫、不知所措" },

  // -------------------- Neutral --------------------
  "thoughtful": { label: "深思",       description: "陷入沉思" },
  "stoic":      { label: "克制",       description: "面无表情、不可读" },
  "calm":       { label: "平静",       description: "沉着、不动声色" },
  "curious":    { label: "好奇",       description: "好奇、机敏" },
  "mysterious": { label: "神秘",       description: "高深莫测、难以捉摸" },
  "dazed":      { label: "恍惚",       description: "梦幻般、神思半离" },
  "sleepy":     { label: "困倦",       description: "昏昏欲睡、眼帘沉重" },
  "unbothered": { label: "毫不在意",   description: "镇定自若的从容" },

  // -------------------- Intense --------------------
  "fierce":      { label: "凶猛",       description: "凶猛、统领全场" },
  "determined":  { label: "坚定",       description: "果断、专注的意志" },
  "passionate":  { label: "热烈",       description: "燃烧般的热情" },
  "brooding":    { label: "阴郁沉思",   description: "黑暗、阴郁的忧郁" },
  "seductive":   { label: "诱惑",       description: "诱人、勾魂" },
  "defiant":     { label: "挑衅不屈",   description: "挑衅、毫不让步" },
  "sultry":      { label: "撩人",       description: "缱绻、眼帘低垂" },
  "smoldering":  { label: "暗涌",       description: "压抑、缓慢燃烧的强烈感" },
  "sinister":    { label: "阴险",       description: "黑暗、阴险、带威胁" },
  "wiccan-mystical":{ label: "神秘巫女",description: "安静的超凡、带神秘色彩" },
  "lazy-shy":    { label: "慵懒带羞",   description: "昏昏欲睡、柔软、半带羞涩" },
  "awe":         { label: "敬畏",       description: "惊叹、敬仰" },
  "shocked":     { label: "震惊",       description: "惊讶、张口呆视" },
  "flirty":      { label: "撩人",       description: "调皮的眉目传情、含笑不去、持续的眼神交流" },
  "suspicious":  { label: "起疑",       description: "戒备性的不信任、眯起的眼睛、斜睨" },
  "resigned":    { label: "认命",       description: "对不愉快境遇的安静接受" },
  "conflicted":  { label: "矛盾",       description: "可见的内心挣扎、眉头紧锁" },
  "relieved": { label: "如释重负", description: "紧张化为平静" },
}

export default map
