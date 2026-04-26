import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Editorial / Fashion --------------------
  "fashion-editorial":  { label: "时尚大片",         description: "高级时装杂志大片" },
  "vogue-editorial":    { label: "Vogue 大片",       description: "Vogue 风格封面大片" },
  "magazine-cover":     { label: "杂志封面",         description: "紧凑构图的封面" },
  "lookbook":           { label: "Lookbook 造型册", description: "干净的造型展示" },
  "ecommerce-flatlay":  { label: "电商平铺",         description: "俯拍产品平铺" },
  "beauty-editorial":   { label: "美妆大片",         description: "微距美妆 / 护肤特写" },
  "campaign-advertising":{ label: "品牌广告",        description: "精致的品牌广告画面" },

  // -------------------- Brand / Editorial Reference --------------------
  "brand-vogue":         { label: "Vogue 标志风格",      description: "Vogue 杂志大片的标志感" },
  "brand-dior":          { label: "Dior 标志风格",       description: "Dior 大片——明暗对比与轮廓" },
  "brand-jil-sander":    { label: "Jil Sander 极简",     description: "Jil Sander——极简、建筑感、低饱和" },
  "brand-vivienne-tam":  { label: "Vivienne Tam 风格",   description: "Vivienne Tam——东方主义华丽时装" },
  "brand-jacquemus":     { label: "Jacquemus 风格",      description: "Jacquemus——阳光超现实顽皮" },
  "brand-helmut-newton": { label: "Helmut Newton 风格",  description: "Helmut Newton——高对比黑白挑衅感" },
  "brand-harpers-bazaar":{ label: "Harper's Bazaar 风格", description: "Harper's Bazaar——高级时装大片光面感" },

  // -------------------- Documentary / Candid --------------------
  "paparazzi":          { label: "狗仔抓拍",         description: "闪光过曝的小报抓拍" },
  "street-photography": { label: "街拍",             description: "未摆拍的城市街景画面" },
  "candid-journalism":  { label: "纪实抓拍",         description: "未摆拍的新闻摄影瞬间" },
  "photojournalism":    { label: "新闻摄影",         description: "新闻级编辑实拍" },
  "documentary":        { label: "纪录片",           description: "纪录片式人物长镜头" },
  "snapshot":           { label: "随手拍",           description: "随性的业余快照" },

  // -------------------- Studio / Formal --------------------
  "corporate-headshot":{ label: "商务证件照",       description: "LinkedIn 风格证件照" },
  "personal-branding": { label: "个人品牌照",       description: "现代个人品牌人像" },
  "yearbook":          { label: "毕业纪念册",       description: "校园纪念册式人像" },
  "id-passport":       { label: "证件 / 护照照",    description: "标准护照照" },
  "mugshot":           { label: "嫌疑人档案照",     description: "警局拘留风格人像" },
  "wedding-portrait":  { label: "婚礼人像",         description: "浪漫新娘风人像" },
  "family-portrait":   { label: "家庭合影",         description: "摆拍式家庭合影" },
  "glamour-portrait":  { label: "魅惑人像",         description: "柔焦魅惑人像" },
  "film-noir":         { label: "黑色电影",         description: "硬阴影黑色电影人像" },

  // -------------------- Selfie sub-types --------------------
  "mirror-selfie":          { label: "镜面自拍",           description: "手机镜面全身自拍" },
  "gym-mirror-selfie":      { label: "健身房镜面自拍",     description: "更衣室健身房镜面自拍" },
  "front-cam-selfie":       { label: "前置自拍",           description: "手臂伸长的前置摄像头自拍" },
  "bathroom-mirror-selfie": { label: "浴室镜面自拍",       description: "带闪光的浴室镜面自拍" },
  "bereal-dual":            { label: "BeReal 双拍",        description: "前后摄像头同时双画面" },
  "flip-cam-selfie":        { label: "翻盖摄像头自拍",     description: "误开的低质量翻盖镜头" },
  "group-selfie":           { label: "多人自拍",           description: "多人同框的手机自拍" },
  "lofi-baddie-selfie":     { label: "Lo-Fi 2010 年代自拍", description: "早期 iPhone 弱光自拍" },

  // -------------------- Print / Context --------------------
  "album-cover":     { label: "专辑封面",       description: "方形专辑封面构图" },
  "movie-poster":    { label: "电影海报",       description: "电影感的院线海报" },
  "advertising":     { label: "广告大片",       description: "光面广告片" },
  "food-photography":{ label: "美食摄影",       description: "俯拍或 45 度的美食拍摄" },
  "real-estate":     { label: "房产摄影",       description: "广角的建筑室内" },
  "sports-action":   { label: "体育动作",       description: "长焦凝固的体育瞬间" },
  "point-and-shoot": { label: "傻瓜机 / 一次性相机", description: "一次性相机美学,硬闪光,随性感" },
  "lifestyle-blog":  { label: "生活博客",         description: "柔和自然光,居家 / 咖啡博主感" },
  "product-shot":    { label: "产品图",           description: "电商风,中性背景上孤立的清晰产品" },
}

export default map
