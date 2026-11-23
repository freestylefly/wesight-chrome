import type { PlatformDefinition } from "~platforms/catalog/types"

/**
 * 国内自媒体号文章（批 1b）. Owned by one batch; add entries only together with their adapters.
 *
 * Title limits are deliberately conservative until each editor is checked on a
 * real account. Sites that will later host a post or video destination on the
 * same hostname declare `paths` for the article route so the sibling can be the
 * hostname fallback.
 */
export const ARTICLE_MEDIA_PLATFORMS = [
  {
    id: "weixin-article", group: "article", label: "微信公众号文章", shortLabel: "公众号",
    editorUrl: "https://mp.weixin.qq.com/",
    titleLimit: 64, accountKey: "weixin", hosts: ["mp.weixin.qq.com"], permission: "optional", stage: "beta",
    brand: { glyph: "公", color: "#07c160" }
  },
  {
    id: "qq-article", group: "article", label: "企鹅号文章", shortLabel: "企鹅号",
    loginCheckUrl: "https://om.qq.com/main/creation/article",
    editorUrl: "https://om.qq.com/main/creation/article",
    titleLimit: 30, accountKey: "qq", hosts: ["om.qq.com"], paths: ["^/main/creation/article(?:/|$)"],
    permission: "optional", stage: "beta",
    brand: { glyph: "企", color: "#1f6fff" }
  },
  {
    id: "baijiahao-article", group: "article", label: "百家号文章", shortLabel: "百家号",
    loginCheckUrl: "https://baijiahao.baidu.com/builder/rc/home",
    editorUrl: "https://baijiahao.baidu.com/builder/rc/edit?type=news",
    titleLimit: 30, accountKey: "baijiahao", hosts: ["baijiahao.baidu.com", "passport.baidu.com"], paths: ["^/builder/rc/edit\\?(?:.*&)?type=news(?:&|$)"],
    permission: "optional", stage: "beta",
    brand: { glyph: "百", color: "#2932e1" }
  },
  {
    id: "netease-article", group: "article", label: "网易号文章", shortLabel: "网易号",
    loginCheckUrl: "https://mp.163.com/",
    editorUrl: "https://mp.163.com/#/article-publish",
    titleLimit: 30, accountKey: "netease", hosts: ["mp.163.com"], permission: "optional", stage: "beta",
    brand: { glyph: "网", color: "#e60026" }
  },
  {
    id: "sohu-article", group: "article", label: "搜狐号文章", shortLabel: "搜狐号",
    editorUrl: "https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle",
    titleLimit: 30, accountKey: "sohu", hosts: ["mp.sohu.com"], permission: "optional", stage: "beta",
    brand: { glyph: "搜", color: "#f0a30a" }
  },
  {
    id: "douyin-article", group: "article", label: "抖音文章", shortLabel: "抖音",
    editorUrl: "https://creator.douyin.com/creator-micro/content/post/article?enter_from=publish_page&media_type=article&type=new",
    titleLimit: 30, accountKey: "douyin", hosts: ["creator.douyin.com"], paths: ["^/creator-micro/content/post/article(?:/|$)"],
    permission: "optional", stage: "beta",
    account: { url: "https://creator.douyin.com/web/api/media/user/info/", name: "user.nickname", avatar: "user.avatar_thumb.url_list.0" },
    brand: { glyph: "抖", color: "#161823" }
  },
  {
    // The article editor is opened from inside a chosen 星球, so there is no
    // verified article-only route yet; zsxq-post should take a `paths` pattern
    // or this entry should gain one once the editor route is confirmed.
    id: "zsxq-article", group: "article", label: "知识星球文章", shortLabel: "知识星球",
    loginCheckUrl: "https://wx.zsxq.com/",
    // The article editor has no route of its own; the marker keeps this tab
    // distinct from zsxq-post, which is the fallback for the host.
    editorUrl: "https://wx.zsxq.com/?wesight_target=article", paths: ["[?&]wesight_target=article(?:&|$)"],
    titleLimit: 30, accountKey: "zsxq", hosts: ["wx.zsxq.com"], permission: "optional", stage: "beta",
    brand: { glyph: "星", color: "#16b998" }
  },
  {
    id: "smzdm-article", group: "article", label: "什么值得买文章", shortLabel: "值得买",
    loginCheckUrl: "https://post.smzdm.com/tougao/",
    editorUrl: "https://post.smzdm.com/tougao/",
    titleLimit: 30, accountKey: "smzdm", hosts: ["post.smzdm.com", "zhiyou.smzdm.com"], permission: "optional", stage: "beta",
    brand: { glyph: "值", color: "#e62828" }
  },
  {
    id: "xueqiu-article", group: "article", label: "雪球文章", shortLabel: "雪球",
    editorUrl: "https://mp.xueqiu.com/writeV2",
    titleLimit: 30, accountKey: "xueqiu", hosts: ["mp.xueqiu.com"], permission: "optional", stage: "beta",
    brand: { glyph: "雪", color: "#1f7ae0" }
  },
  {
    id: "eastmoney-article", group: "article", label: "东方财富财富号文章", shortLabel: "财富号",
    editorUrl: "https://mp.eastmoney.com/collect/pc_article/index.html",
    titleLimit: 30, accountKey: "eastmoney", hosts: ["mp.eastmoney.com", "passport2.eastmoney.com"], permission: "optional", stage: "beta",
    brand: { glyph: "财", color: "#e63a2e" }
  },
  {
    id: "tonghuashun-article", group: "article", label: "同花顺号文章", shortLabel: "同花顺",
    loginCheckUrl: "https://mp.10jqka.com.cn/creation-editor/editor/",
    editorUrl: "https://mp.10jqka.com.cn/creation-editor/editor/",
    titleLimit: 30, accountKey: "tonghuashun", hosts: ["mp.10jqka.com.cn", "upass.10jqka.com.cn"], permission: "optional", stage: "beta",
    brand: { glyph: "同", color: "#d82b2b" }
  },
  {
    id: "yidian-article", group: "article", label: "一点资讯文章", shortLabel: "一点号",
    editorUrl: "https://mp.yidianzixun.com/#/Writing/articleEditor",
    titleLimit: 30, accountKey: "yidian", hosts: ["mp.yidianzixun.com"], permission: "optional", stage: "beta",
    brand: { glyph: "一", color: "#fd4a4b" }
  },
  {
    id: "dayu-article", group: "article", label: "大鱼号文章", shortLabel: "大鱼号",
    editorUrl: "https://mp.dayu.com/dashboard/article/write",
    titleLimit: 30, accountKey: "dayu", hosts: ["mp.dayu.com"], permission: "optional", stage: "beta",
    brand: { glyph: "鱼", color: "#ff6a00" }
  },
  {
    id: "topnews-article", group: "article", label: "顶端号文章", shortLabel: "顶端号",
    editorUrl: "https://mp.topnews.cn/#/scriptWrite",
    titleLimit: 30, accountKey: "topnews", hosts: ["mp.topnews.cn"], permission: "optional", stage: "beta",
    brand: { glyph: "顶", color: "#1677ff" }
  },
  {
    id: "kuaichuan-article", group: "article", label: "360 快传号文章", shortLabel: "快传号",
    editorUrl: "https://kuaichuan.360kuai.com/#/console/publish/article",
    titleLimit: 30, accountKey: "kuaichuan", hosts: ["kuaichuan.360kuai.com"], permission: "optional", stage: "beta",
    brand: { glyph: "快", color: "#19b955" }
  },
  {
    id: "autohome-article", group: "article", label: "汽车之家车家号文章", shortLabel: "车家号",
    loginCheckUrl: "https://creator.autohome.com.cn/web/publish/long",
    editorUrl: "https://creator.autohome.com.cn/web/publish/long",
    titleLimit: 30, accountKey: "autohome", hosts: ["creator.autohome.com.cn", "account.autohome.com.cn"], paths: ["^/web/publish/long(?:/|$)"],
    permission: "optional", stage: "beta",
    brand: { glyph: "车", color: "#3f80f8" }
  },
  {
    id: "dongchedi-article", group: "article", label: "懂车帝懂车号文章", shortLabel: "懂车号",
    account: { url: "https://mp.dcdapp.com/motor/mp_index/api/user/info", name: "data.media.name", avatar: "data.media.https_avatar_url" },
    editorUrl: "https://mp.dcdapp.com/profile_v2/publish/article",
    titleLimit: 30, accountKey: "dongchedi", hosts: ["mp.dcdapp.com"], permission: "optional", stage: "beta",
    brand: { glyph: "懂", color: "#f5b800" }
  }
] as const satisfies readonly PlatformDefinition[]
