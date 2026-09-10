# WeSight 发布助手

WeSight Obsidian 插件的浏览器配套扩展。扩展复用 Chrome 或 Edge 中已有的平台登录状态，将当前内容准备到知乎、CSDN、掘金、B站专栏、今日头条、微博头条文章、小红书图文、微博图文动态和即刻动态编辑页。所有平台的最终发布操作均由用户在页面中确认。

## 下载

- Chrome：[下载最新安装包](https://github.com/freestylefly/wesight-chrome/releases/latest/download/wesight-chrome.zip)
- Edge：[下载最新安装包](https://github.com/freestylefly/wesight-chrome/releases/latest/download/wesight-edge.zip)

## 本地开发

```bash
pnpm install
pnpm dev
```

Chrome 安装步骤：

1. 下载并解压 `wesight-chrome.zip`。
2. 在地址栏打开 `chrome://extensions/`。
3. 开启右上角「开发者模式」。
4. 点击左上角「加载已解压的扩展程序」，选择解压后直接包含 `manifest.json` 的文件夹；也可以把该文件夹拖入扩展管理页。

Edge 可在 `edge://extensions/` 按相同步骤加载解压后的扩展文件夹。首次任务会从 Obsidian 打开本机配对页，扩展完成一次配对后会记住本机通道身份。

1.0.0 请配合 [WeSight for Obsidian 1.0.0](https://github.com/freestylefly/wesight-obsidian/releases/tag/1.0.0) 使用。已安装用户更新原目录文件后，需要在扩展管理页重新加载扩展。完整更新内容见 [1.0.0 更新说明](docs/releases/1.0.0.md)。

## 构建

```bash
pnpm check
pnpm package
```

构建和 ZIP 产物位于 `build/`。Chrome 与 Edge 分别使用 `chrome-mv3-prod` 和 `edge-mv3-prod` 目录。

## 安全边界

- 本地通道仅监听 `127.0.0.1`，正文与图片不经过 WeSight Cloud。
- 扩展不申请 Cookie 权限，直接复用平台页面已有的登录状态。
- 任务令牌有效期为 10 分钟，正文和图片不写入扩展存储。
- 扩展不会点击发布按钮，也不会调用平台正式发布接口。
- 诊断日志最多保留 100 条，并对令牌及密钥字段脱敏。

平台页面结构更新后，单个平台可能需要更新适配器。失败状态会保留在 Popup 和 Obsidian 任务面板中，用户可以登录后重试。
