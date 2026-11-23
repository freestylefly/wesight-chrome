# 新增平台适配器指南

平台清单由 `platforms/catalog/` 统一维护。协议 id、分组、编辑页 URL、URL 匹配、共享账号、可选权限，以及导出给 Obsidian 插件的 `docs/platform-registry.json`，都从这一份清单派生。

## 文件归属（多人并行时互不冲突）

| 批次 | 目录清单 | 适配器表 | 适配器实现 |
|---|---|---|---|
| 批 1a 国内技术社区文章 | `platforms/catalog/article-tech.ts` | `platforms/adapters/article-tech.ts` | `platforms/article-tech/<site>.ts` |
| 批 1b 国内自媒体号文章 | `platforms/catalog/article-media.ts` | `platforms/adapters/article-media.ts` | `platforms/article-media/<site>.ts` |
| 批 2 国内动态 | `platforms/catalog/post-cn.ts` | `platforms/adapters/post-cn.ts` | `platforms/post-cn/<site>.ts` |
| 批 3 海外 | `platforms/catalog/overseas.ts` | `platforms/adapters/overseas.ts` | `platforms/overseas/<site>.ts` |
| 批 4 短视频 | `platforms/catalog/video.ts` | `platforms/adapters/video.ts` | `platforms/video/<site>.ts` |
| 批 5 播客 | `platforms/catalog/podcast.ts` | `platforms/adapters/podcast.ts` | `platforms/podcast/<site>.ts` |

每批只改自己名下的文件，测试放在 `tests/<batch>/`。公共文件（`platforms/catalog/index.ts`、`platforms/index.ts`、`types/protocol.ts`、`contents/platform.ts`、`package.json`）不要改；确有需要时，在交接说明里提出。

## 新增一个平台

1. 在本批的 catalog 里加一条（字段说明见 `platforms/catalog/types.ts`）：
   - `id`：写成"站点-类型"，类型必须与 `group` 一致（`-post`、`-article`、`-video`、`-podcast`）。已发布的 id 永远不改。
   - `permission: "optional"`：新平台一律用可选权限，不改 manifest。用户勾选时由发布中心申请授权，后台再动态注册内容脚本。
   - `stage: "beta"`：真机验收通过后才能改成 `stable`。
   - `hosts`：编辑页和登录页的精确 hostname。和已有平台共用 hostname 时，`accountKey` 必须相同，并用 `paths` 区分（参考 X 文章 / X 动态）。
   - `account`：如果平台有返回 JSON 的"当前用户"接口，可以声明 `{ url, name, avatar }`，用于后台探测登录状态。
2. 实现 `PlatformAdapter`（`platforms/types.ts`）：
   - `detectAccount()`：检查当前页面，可用 `loginPageDetected()` 或站点特有的标记；未登录时返回 `{ loggedIn: false, message }`。
   - `prepareDraft(ctx)`：填写标题、正文、图片、封面、标签，返回 `{ draftUrl, warnings }`。
   - 复用 `platforms/dom.ts` 中的 `waitForAny`、`fillTextControl`、`fillEditable`、`prepareArticle`、`selectAssetFile`、`referencedAssets`，以及 `platforms/post-video.ts`、`lib/post-media.ts`。
   - 遇到页面结构变化时抛出 `PlatformPageChangedError`，错误信息要让用户看得懂。
3. 在本批的 adapters 表里登记，然后运行 `UPDATE_PLATFORM_REGISTRY=1 pnpm test` 更新 `docs/platform-registry.json`。
4. 运行 `pnpm check`，即类型检查、测试和打包。

## 硬性规则

- **不点发布**：适配器只填好内容，停在最终的"发布 / 发表 / 提交"按钮之前，由用户手动点击。测试要断言这些按钮没有被点击。
- **不参考第三方代码**：`samples/` 里的第三方扩展只能用来了解需求（有哪些平台、入口 URL）。不得打开、复制或改写其中的模块、SDK 或适配器代码。`samples/` 永远不提交。
- 选择器优先用稳定的语义信息，例如 placeholder、aria-label、role、按钮文字，不要用哈希化的 class。
- 没有对照真实页面核对过的选择器，在交接说明里逐条列出，等真机验收时修正。
- 不在扩展里保存任何平台密码或令牌。
