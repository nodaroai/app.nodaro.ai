import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Editorial / Fashion --------------------
  "tim-walker":          { description: "以 Tim Walker 的风格,绘画感的童话时装布置,精心搭建的场景与柔和粉彩调色板" },
  "paolo-roversi":       { description: "以 Paolo Roversi 的风格,柔和、空灵的宝丽来光感,扩散的窗光与温暖奶白色调" },
  "marta-bevacqua":      { description: "以 Marta Bevacqua 的风格,梦幻绘画感的人像,静谧自然光与微微低饱和的肤色" },
  "patrick-demarchelier":{ description: "以 Patrick Demarchelier 的风格,精致的经典时装人像,锐利的眼神光与永恒的克制感" },
  "nick-knight":         { description: "以 Nick Knight 的风格,光面前卫时装,饱和色彩、精准锐利与超现实布景" },
  "mario-testino":       { description: "以 Mario Testino 的风格,阳光下魅惑的时装感,自信摆姿与明快的大片色彩" },
  "steven-meisel":       { description: "以 Steven Meisel 的风格,精致的中世纪杂志大片人像,可控棚光与一丝不苟的造型" },
  "helmut-newton":       { description: "以 Helmut Newton 的风格,大胆挑衅的黑白,硬闪、深阴影与建筑感构图" },
  "mario-sorrenti":      { description: "以 Mario Sorrenti 的风格,亲密颗粒感的时装摄影,生硬自然光与忏悔般的近距感" },
  "annie-leibovitz":     { description: "以 Annie Leibovitz 的风格,电影感的明星人像,戏剧化布置与温暖立体的灯光" },
  "felicia-simion":      { description: "以 Felicia Simion 的风格,超现实田园美术摄影,安静的象征意味与柔和的大地色板" },
  "oleg-oprisco":        { description: "以 Oleg Oprisco 的风格,电影感的胶片颗粒叙事,绘画感的服装与模拟胶片的色调" },
  "bella-kotak":         { description: "以 Bella Kotak 的风格,魔幻奇幻民俗人像,金色光、花卉与丰富的绘画调色" },
  "yigal-ozeri":         { description: "以 Yigal Ozeri 的风格,超写实的绘画人像,通透的肤色与林间斑驳光" },
  "jimmy-marble":        { description: "以 Jimmy Marble 的风格,粉彩糖果般明亮的大片摄影,顽皮色块与干净棚拍形状" },
  "rinko-kawauchi":      { description: "以 Rinko Kawauchi 的风格,安静、被光浸透的日常摄影,梦幻粉雾与轻微过曝" },
  "ellen-von-unwerth":   { description: "以 Ellen von Unwerth 的风格,顽皮复古的海报女郎能量,黑白闪光与调皮肢体语言" },

  // -------------------- Documentary / Street --------------------
  "henri-cartier-bresson":{ description: "以 Henri Cartier-Bresson 的风格,决定性瞬间的黑白街头摄影,几何构图与自然光" },
  "vivian-maier":         { description: "以 Vivian Maier 的风格,中世纪美国街头摄影,方形构图、敏锐的观察与银色丰盈的黑色" },
  "saul-leiter":          { description: "以 Saul Leiter 的风格,绘画感的彩色街拍透过雾玻璃与雨水,抽象层次构图" },
  "daido-moriyama":       { description: "以 Daido Moriyama 的风格,颗粒感、高对比的东京街头摄影,过曝高光与躁动的手持感" },
  "robert-capa":          { description: "以 Robert Capa 的风格,直击的战地摄影,动态模糊、粗糙颗粒与即时的手持视点" },
  "sebastiao-salgado":    { description: "以 Sebastiao Salgado 的风格,史诗感单色社会纪实,壮阔风光与明暗对比的影调" },
  "diane-arbus":          { description: "以 Diane Arbus 的风格,直白对峙的人像,正视镜头、方形画幅与不躲闪的日光" },

  // -------------------- Cinematographers --------------------
  "roger-deakins":      { description: "以 Roger Deakins 的电影摄影风格,绘画般的自然光、刻画清晰的剪影、深邃的负空间与克制的色彩" },
  "emmanuel-lubezki":   { description: "以 Emmanuel Lubezki 的电影摄影风格,飘动的手持自然光,黄金时刻的金色辉光与广角包覆感" },
  "greig-fraser":       { description: "以 Greig Fraser 的电影摄影风格,丰富、有质感的类型片摄影,变形镜头光斑、深黑与氛围雾感" },
  "christopher-doyle":  { description: "以 Christopher Doyle 的电影摄影风格,饱和的手持霓虹氛围,拉丝光轨与梦幻慢门模糊" },

  // -------------------- Concept --------------------
  "greg-rutkowski":     { description: "以 Greg Rutkowski 的风格,史诗绘画感的奇幻概念艺术,壮阔构图、戏剧化的光柱与油画笔触" },
  "magali-villeneuve":  { description: "以 Magali Villeneuve 的风格,英雄气质的奇幻角色艺术,精致铠甲、绘画感肤质与暖金光" },
  "charlie-bowater":    { description: "以 Charlie Bowater 的风格,氛围感数字人像,绘画肌理、阴郁色彩与亲密近景构图" },
  "sam-spratt":         { description: "以 Sam Spratt 的风格,寓言式超写实人像,雕塑感光影、象征性细节与古典大师的影调深度" },
  "ruan-jia":           { description: "以 Ruan Jia 的风格,丰盈绘画感的奇幻人像,华美布料、镀金点缀与暖色定向光" },
  "ilya-kuvshinov":     { description: "以 Ilya Kuvshinov 的风格,带动漫感的风格化人像,柔和赛璐璐感、偏大的眼睛与粉彩轮廓光" },
  "wlop":               { description: "以 WLOP 的风格,空灵绘画感的奇幻人像,飘动的发丝、发光的轮廓光与冷色单色板" },
  "artgerm":            { description: "以 Artgerm 的风格,精致的漫画感海报女郎插画,平滑渐变与利落的图形高光" },

  // -------------------- Illustrators --------------------
  "makoto-shinkai":     { description: "以 Makoto Shinkai 的风格,电影感的动漫天空与光,发光的云、镜头光斑下的太阳与饱和的暮色渐变" },
  "studio-ghibli":      { description: "以 Studio Ghibli 的风格,手绘动画的温暖,柔和粉彩天空、葱郁植被与温柔的角色表情" },
  "alphonse-mucha":     { description: "以 Alphonse Mucha 的风格,新艺术装饰画板,花卉边框、飘逸的发丝与温暖镀金色调" },
  "carne-griffiths":    { description: "以 Carne Griffiths 的风格,墨水晕染的植物人像,书法线条、茶水点泼与缠绕花卉" },
  "conrad-roset":       { description: "以 Conrad Roset 的风格,温柔的水彩人像,柔和铅笔线、墨色晕染与浅淡肤色" },
  "akihito-yoshida":    { description: "以 Akihito Yoshida 的风格,安静的水墨颗粒感单色人像,速写线条与沉思般的负空间" },
  "karol-bak":          { description: "以 Karol Bak 的风格,象征派绘画女神,镀金叶子点缀、新艺术装饰与暖大地色颜料" },
  "ismail-inceoglu":    { description: "以 Ismail Inceoglu 的风格,神话般的绘画风光,巨幅尺度、层叠雾气与故事感灯光" },
  "stefan-gesell":      { description: "以 Stefan Gesell 的风格,黑暗超现实人像,高对比黑白、戴面具的人物与不安的舞台灯光" },
  "andrew-atroshenko":  { description: "以 Andrew Atroshenko 的风格,浪漫印象派人体油画,松散可见的笔触与闪烁的烛光" },
  "peter-gric":         { description: "以 Peter Gric 的风格,建筑感超现实风光,水晶状几何结构与冷调静谧色板" },
  "ingrid-baars":       { description: "以 Ingrid Baars 的风格,雕塑感时尚艺术拼贴,拉长的形体、平滑彩绘的肤质与精致面料" },
  "guido-van-helten":   { description: "以 Guido van Helten 的风格,纪念碑式壁画人像,风化水泥肌理与安静的灰阶影调" },
}

export default map
