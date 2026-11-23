import type { PlatformDefinition } from "~platforms/catalog/types"

/** 国内动态（批 2）. Owned by one batch; add entries only together with their adapters. */
export const POST_CN_PLATFORMS = [
  {
    id: "toutiao-post", group: "post", label: "微头条", shortLabel: "微头条", editorUrl: "https://mp.toutiao.com/profile_v4/weitoutiao/publish",
    titleLimit: 2000, accountKey: "toutiao", hosts: ["mp.toutiao.com", "sso.toutiao.com"], paths: ["^/profile_v4/weitoutiao(?:[/?]|$)"],
    permission: "optional", stage: "beta", media: { images: 9, video: false }, textLimit: 2000,
    brand: { glyph: "头", color: "#f04142", caption: "标签会写成 #话题#" }
  },
  {
    id: "zhihu-post", group: "post", label: "知乎想法", shortLabel: "知乎想法", editorUrl: "https://www.zhihu.com/follow",
    titleLimit: 50, accountKey: "zhihu", hosts: ["www.zhihu.com"], paths: ["^/follow(?:[/?]|$)"],
    permission: "optional", stage: "beta", media: { images: 9, video: false }, textLimit: 1000,
    brand: { glyph: "知", color: "#1772f6", caption: "话题需在知乎页面手动添加" }
  },
  {
    id: "bilibili-post", group: "post", label: "B站动态", shortLabel: "B站动态", editorUrl: "https://t.bilibili.com/",
    titleLimit: 20, accountKey: "bilibili", hosts: ["t.bilibili.com", "passport.bilibili.com"],
    permission: "optional", stage: "beta", media: { images: 9, video: false }, textLimit: 1000,
    brand: { glyph: "B", color: "#fb7299", caption: "标签会写成 #话题#" }
  },
  {
    id: "juejin-post", group: "post", label: "掘金沸点", shortLabel: "沸点", editorUrl: "https://juejin.cn/pins",
    titleLimit: 1000, accountKey: "juejin", hosts: ["juejin.cn", "passport.juejin.cn"], paths: ["^/pins(?:[/?]|$)"],
    permission: "optional", stage: "beta", media: { images: 9, video: false }, textLimit: 1000,
    brand: { glyph: "沸", color: "#1e80ff", caption: "圈子需在掘金页面手动选择" }
  },
  {
    id: "douyin-post", group: "post", label: "抖音图文", shortLabel: "抖音图文", editorUrl: "https://creator.douyin.com/creator-micro/content/post/image?media_type=image&type=new",
    titleLimit: 20, accountKey: "douyin", hosts: ["creator.douyin.com"], paths: ["^/creator-micro/content/post/image(?:[/?]|$)"],
    permission: "optional", stage: "beta", media: { images: 9, video: false, requiresMedia: true }, textLimit: 1000,
    account: { url: "https://creator.douyin.com/web/api/media/user/info/", name: "user.nickname", avatar: "user.avatar_thumb.url_list.0" },
    brand: { glyph: "抖", color: "#161823", caption: "至少需要一张图片，标签会写成 #话题" }
  },
  {
    id: "kuaishou-post", group: "post", label: "快手图文", shortLabel: "快手图文", editorUrl: "https://cp.kuaishou.com/article/publish/video?tabType=2",
    titleLimit: 500, accountKey: "kuaishou", hosts: ["cp.kuaishou.com", "passport.kuaishou.com"],
    paths: ["^/article/publish/video\\?(?:.*&)?tabType=2(?:&|$)"],
    permission: "optional", stage: "beta", media: { images: 9, video: false, requiresMedia: true }, textLimit: 500,
    brand: { glyph: "快", color: "#ff4906", caption: "至少需要一张图片，标签会写成 #话题" }
  },
  {
    id: "xueqiu-post", group: "post", label: "雪球动态", shortLabel: "雪球", editorUrl: "https://xueqiu.com/",
    titleLimit: 2000, accountKey: "xueqiu", hosts: ["xueqiu.com"],
    permission: "optional", stage: "beta", media: { images: 9, video: false },
    brand: { glyph: "雪", color: "#0b6cf2", caption: "标签会写成 #话题#" }
  },
  {
    id: "douban-post", group: "post", label: "豆瓣广播", shortLabel: "豆瓣", editorUrl: "https://www.douban.com/",
    titleLimit: 2000, accountKey: "douban", hosts: ["www.douban.com", "accounts.douban.com"],
    permission: "optional", stage: "beta", media: { images: 9, video: false },
    brand: { glyph: "豆", color: "#007722", caption: "话题需在豆瓣页面手动添加" }
  },
  {
    id: "zsxq-post", group: "post", label: "知识星球主题", shortLabel: "知识星球", editorUrl: "https://wx.zsxq.com/",
    titleLimit: 2000, accountKey: "zsxq", hosts: ["wx.zsxq.com"],
    permission: "optional", stage: "beta", media: { images: 9, video: false },
    brand: { glyph: "星", color: "#16b998", caption: "发到当前打开的星球，标签需手动添加" }
  },
  {
    id: "shipinhao-post", group: "post", label: "视频号图文", shortLabel: "视频号图文", editorUrl: "https://channels.weixin.qq.com/platform/post/finderNewLifeCreate",
    loginCheckUrl: "https://channels.weixin.qq.com/platform",
    titleLimit: 20, accountKey: "shipinhao", hosts: ["channels.weixin.qq.com"], paths: ["^/platform/post/finderNewLifeCreate(?:[/?]|$)"],
    permission: "optional", stage: "beta", media: { images: 9, video: false, requiresMedia: true }, textLimit: 1000,
    brand: { glyph: "视", color: "#fa9d3b", caption: "至少需要一张图片，标签会写成 #话题" }
  },
  {
    id: "xiaoheihe-post", group: "post", label: "小黑盒图文", shortLabel: "小黑盒", editorUrl: "https://www.xiaoheihe.cn/creator/editor/draft/image_text",
    titleLimit: 30, accountKey: "xiaoheihe", hosts: ["www.xiaoheihe.cn"], paths: ["^/creator/editor/draft/image_text(?:[/?]|$)"],
    permission: "optional", stage: "beta", media: { images: 9, video: false },
    brand: { glyph: "黑", color: "#1a1d24", caption: "话题需在小黑盒页面手动添加" }
  },
  {
    id: "maimai-post", group: "post", label: "脉脉动态", shortLabel: "脉脉", editorUrl: "https://maimai.cn/community/home/following",
    loginCheckUrl: "https://maimai.cn/community/home/following",
    titleLimit: 2000, accountKey: "maimai", hosts: ["maimai.cn"],
    permission: "optional", stage: "beta", media: { images: 9, video: false },
    brand: { glyph: "脉", color: "#2c7cf6", caption: "话题需在脉脉页面手动添加" }
  },
  {
    id: "dedao-post", group: "post", label: "得到知识城邦", shortLabel: "得到", editorUrl: "https://www.dedao.cn/knowledge/home",
    titleLimit: 2000, accountKey: "dedao", hosts: ["www.dedao.cn"],
    permission: "optional", stage: "beta", media: { images: 9, video: false },
    brand: { glyph: "得", color: "#ff6b00", caption: "话题需在得到页面手动添加" }
  },
  {
    id: "baijiahao-post", group: "post", label: "百家号动态", shortLabel: "百家号动态", editorUrl: "https://baijiahao.baidu.com/builder/rc/edit?type=events",
    titleLimit: 1000, accountKey: "baijiahao", hosts: ["baijiahao.baidu.com"],
    paths: ["^/builder/rc/edit\\?(?:.*&)?type=events(?:&|$)"],
    permission: "optional", stage: "beta", media: { images: 9, video: false }, textLimit: 1000,
    brand: { glyph: "百", color: "#2468f2", caption: "话题需在百家号页面手动添加" }
  }
] as const satisfies readonly PlatformDefinition[]
