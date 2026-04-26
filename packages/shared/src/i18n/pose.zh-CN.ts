import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Standing --------------------
  "standing-upright":     { label: "笔直站立",       description: "放松的直立姿势" },
  "confident-stance":     { label: "自信站姿",       description: "双脚分开,肩膀打开" },
  "hands-on-hips":        { label: "双手叉腰",       description: "双手叉腰" },
  "arms-crossed":         { label: "抱臂",           description: "双臂在胸前交叉" },
  "leaning":              { label: "倚靠",           description: "斜靠在某物上" },
  "hero-pose":            { label: "英雄姿势",       description: "戏剧化的英雄站姿" },
  "contrapposto":         { description: "胯部一侧倾斜,重心放在一条腿上" },
  "leaning-against-wall": { label: "靠墙",           description: "随性地靠在墙上" },
  "hands-behind-head":    { label: "双手抱头",       description: "双手在脑后交叉" },
  "hands-behind-back":    { label: "双手背后",       description: "双手在身后交握" },

  // -------------------- Seated --------------------
  "sitting":            { label: "坐",                 description: "自然地坐着" },
  "cross-legged":       { label: "盘腿",               description: "盘腿坐在地上" },
  "kneeling":           { label: "跪",                 description: "跪在地上" },
  "crouching":          { label: "蹲",                 description: "低身蹲下" },
  "lounging":           { label: "斜倚",               description: "放松地斜倚而坐" },
  "sitting-edge-of-bed":{ label: "坐在床沿",           description: "坐在床的边缘" },
  "chair-arm-drape":    { label: "腿搭椅扶手",         description: "双腿随意地搭在椅子扶手上" },
  "elbow-propped":      { label: "脸颊靠手肘",         description: "脸颊托在支起的手肘上" },
  "lying-on-stomach-reading":{ label: "趴着阅读",       description: "趴在地上,以手肘撑起身体阅读" },

  // -------------------- Movement --------------------
  "walking":  { label: "行走",       description: "迈步行走中" },
  "running":  { label: "奔跑",       description: "奔跑中、运动状态" },
  "jumping":  { label: "跳跃",       description: "腾空、跳跃中" },
  "dancing":  { label: "跳舞",       description: "跳舞中、舞动瞬间" },
  "climbing": { label: "攀爬",       description: "向上抓握攀爬中" },
  "mid-fall": { label: "下坠中",     description: "在半空中下坠的瞬间" },
  "mid-spin": { label: "旋转中",     description: "旋转中、转身的瞬间" },
  "stretching":{ label: "伸展",      description: "全身伸展、双臂上举" },
  "reaching-up":{ label: "向上伸手", description: "双臂或单臂向上伸展" },
  "kissing":  { label: "亲吻",       description: "锁住一个吻" },
  "riding":   { label: "骑乘",       description: "骑自行车、马或摩托车" },
  "driving":  { label: "驾驶",       description: "在方向盘后驾驶车辆" },

  // -------------------- Action --------------------
  "fighting-stance":   { label: "战斗姿态",     description: "格斗就绪姿态" },
  "reaching":          { label: "伸手",         description: "向外伸手" },
  "throwing":          { label: "投掷",         description: "抛掷动作中" },
  "leaping":           { label: "跃出",         description: "向前充满动感地跃起" },
  "dramatic-action":   { label: "戏剧化动作",   description: "夸张的戏剧化动作姿势" },
  "biting-lip":        { label: "咬唇",         description: "顽皮地轻咬下唇" },
  "mid-laugh":         { label: "大笑中",       description: "大笑中、头向后仰" },
  "pointing-at-camera":{ label: "指向镜头",     description: "用一根手指直接指向镜头" },
  "tongue-out":        { label: "吐舌头",       description: "顽皮地吐出舌头" },
  "thinking":          { label: "思考",         description: "手托下巴、若有所思" },

  // -------------------- Resting --------------------
  "lying-down":         { label: "躺下",       description: "平躺" },
  "sleeping":           { label: "睡觉",       description: "闭眼睡觉" },
  "hugging":            { label: "拥抱",       description: "抱住另一人" },
  "looking-away":       { label: "侧目远望",   description: "头偏向一边、目光看向远方" },
  "looking-up":         { label: "仰望",       description: "仰望天空" },
  "looking-down":       { label: "俯视",       description: "目光低垂" },
  "head-over-shoulder": { label: "回眸",       description: "回头越过肩膀看" },
  "wading-in-water":    { label: "涉水",       description: "齐大腿深地涉水而行" },

  // -------------------- Hand Position --------------------
  "hands-in-pockets":           { label: "双手插兜",       description: "双手都插在口袋里" },
  "hand-on-hip":                { label: "单手叉腰",       description: "一只手放在腰上" },
  "hand-position-hands-on-hips":{ label: "双手叉腰",       description: "双手都叉在腰上" },
  "hand-on-chin":               { label: "手托下巴",       description: "一只手放在下巴下方" },
  "hand-on-collarbone":         { label: "手按锁骨",       description: "一只手轻搭在锁骨上" },
  "hand-brushing-hair":         { label: "手拢头发",       description: "一只手穿过发间" },
  "finger-to-lip":              { label: "手指抵唇",       description: "指尖轻抵下唇" },
  "arms-wrapped-around-self":   { label: "双臂自抱",       description: "自我拥抱、双臂环绕躯干" },
  "hands-clasped":              { label: "双手交握",       description: "双手在身前交握" },

  // -------------------- Body Lean --------------------
  "leaning-back":           { label: "向后倾",       description: "上身略向后倾" },
  "leaning-forward":        { label: "向前倾",       description: "上身倾向镜头" },
  "body-lean-contrapposto": { label: "Contrapposto", description: "重心放在一条腿上,胯部外推" },
  "arched-back":            { label: "挺背",         description: "背微微挺起、胸部前送" },
  "shoulder-rolled-forward":{ label: "一肩前倾",     description: "一只肩膀向前内卷" },

  // -------------------- Head Tilt --------------------
  "tilted-up":   { label: "向上抬",     description: "头微微抬起" },
  "tilted-down": { label: "向下垂",     description: "头微微低下" },
  "tilted-side": { label: "向侧倾",     description: "头偏向一侧肩膀" },
  "tilted-back": { label: "向后仰",     description: "头完全后仰、暴露喉咙" },
  "chin-up":     { label: "下巴抬起",   description: "下巴抬起、俯视般" },
  "chin-tucked": { label: "下巴内收",   description: "下巴向胸口内收" },

  // -------------------- Activity --------------------
  "activity-smoking":            { label: "吸烟",                 description: "拿着并吸着一支香烟" },
  "activity-drinking":           { label: "喝水 / 饮酒",          description: "举起杯或瓶饮用" },
  "activity-eating":             { label: "进食",                 description: "咬一口食物" },
  "activity-talking-on-phone":   { label: "打电话",               description: "举着手机贴耳通话" },
  "activity-texting":            { label: "发短信",               description: "低头看手机、双手拇指打字" },
  "activity-typing-laptop":      { label: "敲笔记本电脑",         description: "双手在键盘上、专注盯着屏幕" },
  "activity-reading":            { label: "阅读",                 description: "翻开一本书或杂志" },
  "activity-writing":            { label: "书写",                 description: "用笔在笔记本上书写" },
  "activity-painting":           { label: "绘画",                 description: "在画布上作画" },
  "activity-playing-instrument": { label: "演奏乐器",             description: "演奏乐器" },
  "activity-cooking":            { label: "做饭",                 description: "在厨房灶台上做饭" },
  "activity-driving":            { label: "驾驶",                 description: "握着方向盘开车" },
}

export default map
