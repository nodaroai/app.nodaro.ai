import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- 20th-century decades --------------------
  "1920s-flapper":  { label: "1920 年代 Flapper", description: "爵士时代地下酒吧的魅惑感" },
  "1930s-art-deco": { label: "1930 年代装饰艺术", description: "流线型 Art Deco 魅惑感" },
  "1940s-wartime":  { label: "1940 年代战时",     description: "战时实用风与胜利卷发" },
  "1950s-diner":    { label: "1950 年代餐车 / 海报女郎", description: "镀铬餐车与高蓬蓬头海报女郎" },
  "1960s-mod":      { label: "1960 年代 Mod",     description: "摆动伦敦 Mod 图形感" },
  "1970s-disco":    { label: "1970 年代迪斯科",   description: "Studio 54 的镜面球闪光" },
  "1980s-neon":     { label: "1980 年代霓虹",     description: "肩垫 MTV 霓虹过剩感" },
  "1990s-mall":     { label: "1990 年代商场",     description: "商场少女味 Grunge 与流行九十年代" },
  "2000s-y2k":      { label: "2000 年代狗仔 / Y2K", description: "狗仔闪光下的低腰小报时代" },
  "atomic-age-50s": { label: "1950 年代原子时代", description: "1950 年代科幻未来感叠加冷战焦虑" },
  "gen-z-2020s":    { label: "Z 世代 2020 年代", description: "手机优先构图,TikTok 化造型,Y2K 复兴" },
  "fin-de-siecle":  { label: "世纪末",           description: "美好年代的世纪之交欧式优雅" },

  // -------------------- Pre-modern --------------------
  "medieval":     { label: "中世纪",       description: "欧洲石堡中世纪" },
  "renaissance":  { label: "文艺复兴",     description: "佛罗伦萨天鹅绒与壁画的辉煌" },
  "victorian":    { label: "维多利亚时代", description: "煤气灯下的紧身胸衣与蕾丝 19 世纪" },
  "edwardian":    { label: "爱德华时代",   description: "美好年代的茶园细致感" },
  "wild-west":    { label: "美西拓荒",     description: "烈日下的边境牛仔美式风" },
  "ancient-rome": { label: "古罗马",       description: "大理石柱廊的帝国罗马" },
  "ancient-egypt":{ label: "古埃及",       description: "法老金饰与亚麻的尼罗河" },
  "feudal-japan": { label: "幕府日本",     description: "江户时代的武士与艺伎" },
  "roaring-prewar":{ label: "战前喧嚣岁月",description: "1910 年代末新艺术运动的临界感" },

  // -------------------- Speculative --------------------
  "near-future":      { label: "近未来",         description: "5 至 15 年内可信的未来" },
  "far-future":       { label: "远未来",         description: "数百年后的星际时代" },
  "dieselpunk":       { label: "Dieselpunk 柴油朋克", description: "1930–40 年代工业架空历史" },
  "atompunk":         { label: "Atompunk 原子朋克",   description: "1950 年代未来感的太空时代乐观主义" },
  "cyberpunk-future": { label: "赛博朋克未来",   description: "霓虹大都会的高科技低生活" },
  "post-apocalyptic": { label: "后末日",         description: "拾荒者的废土生存" },
  "retrofuturism":    { label: "复古未来主义",   description: "昨日想象中的明日怀旧" },
}

export default map
