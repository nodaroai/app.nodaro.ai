import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Transformation ──
  "auto": { label: "自动", description: "让模型自主选择" },
  "none": { label: "无", description: "无角色特效" },
  "werewolf": { label: "狼人", description: "变身为狼人" },
  "vampire": { label: "吸血鬼", description: "变身为吸血鬼" },
  "cyborg": { label: "赛博格揭示", description: "皮肤裂开露出机械内构" },
  "ghost-form": { label: "灵体化", description: "身体变为半透明的幽灵态" },
  "statue-stone": { label: "石化", description: "身体石化成石像" },
  "liquid-metal": { label: "液态金属", description: "T-1000风格的镜面液态金属形态" },
  "animalization": { label: "动物化", description: "变形为动物" },
  "gorilla-form": { label: "大猩猩形态", description: "变身为银背大猩猩" },
  "mystification": { label: "神秘变身", description: "魔法光环包裹并完成变形" },
  "gas-form": { label: "气态变形", description: "身体消散为气态旋云后重新凝聚" },
  "diamond-skin": { label: "钻石肌肤", description: "皮肤结晶化为钻石切面" },
  "agent-reveal": { label: "特工变装", description: "西装与墨镜迅速出现" },

  // ── Power ──
  "fire-breathe": { label: "喷火", description: "口吐持续的橙黄色火焰射流" },
  "ice-breathe": { label: "冰息", description: "呼出一道冷冻气流" },
  "air-bending": { label: "气宗", description: "操控旋转的气流漩涡" },
  "water-bending": { label: "水宗", description: "以手势操控流动的水" },
  "earth-bending": { label: "土宗", description: "从地面召唤石板升起" },
  "lightning-hands": { label: "雷电之手", description: "双手迸出蓝白电弧" },
  "levitation": { label: "悬浮", description: "缓缓离地升起" },
  "telekinesis": { label: "心灵遥控", description: "附近物体漂浮并环绕旋转" },
  "invisibility": { label: "隐身", description: "身体淡化为透明屈光轮廓" },
  "hero-flight": { label: "英雄飞行", description: "以超英姿势腾空而起" },
  "super-speed": { label: "超速", description: "化为模糊的超高速残影" },
  "soul-departure": { label: "灵魂出窍", description: "半透明灵魂从身体中升起" },

  // ── Body-Mod ──
  "wings-grow": { label: "翅膀生长", description: "背部长出双翼并展开" },
  "horns-grow": { label: "角破皮而出", description: "头部生长出弯曲的角" },
  "tail-emerge": { label: "尾巴伸出", description: "脊椎根部长出尾巴" },
  "tentacles-emerge": { label: "触手伸出", description: "背部或躯干伸出蠕动的触手" },
  "extra-eyes": { label: "额外眼睛睁开", description: "面部和身体各处额外的眼睛依次睁开" },
  "head-explode": { label: "头部爆裂", description: "头部猛烈爆开（PG-13，风格化）" },
  "head-off": { label: "头部脱落", description: "头部平滑脱离飘浮（PG-13，风格化）" },
  "spiders-from-mouth": { label: "口吐蜘蛛", description: "蜘蛛从张开的嘴里爬出（恐怖风格）" },
  "skin-surge": { label: "皮下涌动", description: "皮肤下涌现波浪状运动" },

  // ── Face-Expression ──
  "horror-face": { label: "恐怖面孔", description: "面部扭曲成恐怖表情" },
  "oni-mask": { label: "鬼面", description: "鬼神面具在脸上显现" },
  "glowing-eyes": { label: "发光眼睛", description: "眼睛从内部点燃发光" },
  "floral-eyes": { label: "花之眼", description: "花朵从眼眶中绽放而出" },
  "bloom-mouth": { label: "花开之口", description: "花朵和藤蔓从张开的嘴中蔓延而出" },
  "x-ray": { label: "X光透视", description: "身体变为X光风格，骨骼清晰可见" },
  "agent-snap": { label: "墨镜弹出", description: "墨镜以明快的视觉节奏扣上" },
  "visor-x": { label: "赛博护目镜", description: "科幻赛博护目镜在眼前显现" },

  // ── Aura-Ambient ──
  "paparazzi": { label: "狗仔闪光灯", description: "相机闪光灯在主体周围不断弹出" },
  "money-rain": { label: "金钱雨", description: "纸币从上方飘落" },
  "color-rain": { label: "彩色雨", description: "鲜艳彩色雨滴围绕主体飘落" },
  "saint-glow": { label: "圣人光环", description: "光晕与神圣光芒萦绕主体" },
  "fire-aura": { label: "火焰光环", description: "火舌围绕身体轮廓舔舐跳动" },
  "frost-aura": { label: "寒冰光环", description: "霜雪冰晶从主体向外辐射" },
  "shadow-aura": { label: "暗影光环", description: "黑暗触须在主体周围蠕动涌动" },
  "electricity-aura": { label: "电力光环", description: "特斯拉线圈式电弧在主体周围爆裂" },
  "sparkles-around": { label: "魔法闪光", description: "魔法闪光粒子环绕主体旋转" },
  "fairies-around": { label: "仙子围绕", description: "微小的发光仙子在周围嬉戏飞翔" },
  "objects-orbit": { label: "物体环绕", description: "小物体漂浮并环绕主体旋转" },
  "petals-around": { label: "花瓣环绕", description: "樱花花瓣在主体周围轻柔飘落" },
  "glow-trace": { label: "发光轨迹", description: "明亮的轨迹跟随主体每一个动作" },
  "tattoo-animation": { label: "纹身动画", description: "皮肤上的纹身发光并开始动态移动" },
}

export default map
