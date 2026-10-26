# Chrome Web Store 权限理由

以下英文可复制到开发者后台对应字段。内容依据当前 Manifest 的五项权限、固定网站权限及可选网站权限编写。

## 单一用途

```text
Prepare user-provided articles and social posts as drafts on selected publishing platforms. Users can import local Markdown files, supply an article link, compose a social post, or import content from a paired WeSight Obsidian plugin. The extension fills editors, uploads selected media and saves drafts; the user reviews the result and confirms final publication on each platform.
```

## storage：本机草稿与配置

```text
Store the user's current article and social-post drafts, selected media, publishing preferences, platform account display information, task progress and retry checkpoints locally. Storage also holds the WeSight refresh token and Obsidian pairing configuration; short-lived access tokens and task credentials use session storage. Locally stored diagnostic logs are filtered for secrets and limited to 100 entries. This enables draft editing, account display, connection recovery and retries within the extension's draft-preparation purpose.
```

## alarms：本机通道检测

```text
Schedule availability checks for the user's paired WeSight Obsidian service on 127.0.0.1 while the Manifest V3 background worker can be suspended. Checks normally run once per minute and back off to once every five minutes when the service is unavailable. The alarm is removed when no pairing exists. This keeps the extension's visible connection status current and supports importing the user's content from Obsidian.
```

## tabs：定位与恢复编辑页

```text
Identify and reuse existing tabs for supported publishing platforms, read their URLs to locate the correct account or editor page, open and focus selected editors, and restore a task's draft tabs. The extension also opens its own publishing center and WeSight account pages, watches its own sign-in callback, and monitors platform login tabs. If account detection temporarily opens a background platform tab, it closes that tab after detection unless the user has activated it or navigated elsewhere. Tab information is used for these workflows; unrelated browsing activity is not retained or transmitted.
```

## scripting：填充编辑器与检测账号

```text
Run packaged extension functions in supported platform tabs to identify the signed-in account, fill article editors and upload the user's selected media using the platform's existing editor and session. Some editors require execution in the page's main world to access their native editor or upload APIs. Injected functions are included in the extension package and are restricted to supported platform workflows. Draft preparation ends with user review; final publication remains a manual action on the platform.
```

## declarativeNetRequestWithHostAccess：登录回调

```text
Install a temporary session redirect rule for the exact WeSight sign-in completion URL in the single tab opened by this extension. The rule redirects the one-time authorization code to the extension's packaged auth-callback page so the existing desktop-oriented completion page does not launch the desktop application. The rule is restricted to that tab, the api.wesight.ai completion route and main-frame navigation, and is removed after completion or sign-out. It enables the extension's own WeSight login and membership check.
```

## 固定网站权限：合并说明

后台若只提供一个 Host permission justification 字段，可使用以下完整说明；后续各组便于逐项核对。

```text
Supported platform hosts identify the signed-in account and prepare user-selected drafts on Zhihu, CSDN, Juejin, Bilibili, Toutiao, Weibo, Xiaohongshu, Jike and X. Their account, login and upload hosts support these workflows through existing browser sessions. The user confirms final publication. 127.0.0.1 connects to the paired local WeSight Obsidian service to import content and report progress. api.wesight.ai handles sign-in, token exchange/refresh, account display and membership checks; article text, social-post text and media are not sent there. upload.x.com receives X article images. Public scripts from abs.twimg.com are fetched without login credentials only to parse X article API operation identifiers, feature names and the public authorization value as data. Downloaded JavaScript is never evaluated, injected, imported or executed. All executable extension logic is packaged with the extension.
```

## 本机 Obsidian 通道

适用：`http://127.0.0.1/*`

```text
Connect to the local WeSight service started by the user's paired Obsidian plugin. Import the user's selected article or social-post content and media, verify the pairing and signed account summary, check connection availability, and return task progress or draft addresses to Obsidian. The service uses a variable local port, so access to the loopback host is required. Pairing and task handoffs are validated against the local service origin and the /wesight-bridge route.
```

## 知乎

适用：`https://www.zhihu.com/*`、`https://zhuanlan.zhihu.com/*`

```text
Detect the user's signed-in Zhihu account, open the article editor, upload selected article images through Zhihu's own upload flow, and fill the title and article body for user review. The user completes final publication in Zhihu.
```

## CSDN

适用：`https://www.csdn.net/*`、`https://editor.csdn.net/*`、`https://mp.csdn.net/*`、`https://passport.csdn.net/*`、`https://g-api.csdn.net/*`

```text
Read the current CSDN account's nickname and avatar using CSDN's toolbar account endpoint or existing page, recognize CSDN login/editor pages, upload the user's selected images through the native editor integration, and fill the article title and body. CSDN's article editor can use an editable child frame, which is handled by a packaged content script. The user reviews and publishes the prepared article in CSDN.
```

## 掘金

适用：`https://juejin.cn/*`、`https://passport.juejin.cn/*`、`https://api.juejin.cn/*`

```text
Identify the current Juejin account through its account endpoint and login/editor pages, open the article editor, upload selected images through the site's editor integration, and fill the user's article content. The user reviews the prepared draft and confirms final publication in Juejin.
```

## B站

适用：`https://member.bilibili.com/*`、`https://api.bilibili.com/*`、`https://passport.bilibili.com/*`

```text
Detect the signed-in Bilibili account, recognize the creator login/editor flow, upload the user's article images and save a Bilibili article draft. A page-readable CSRF value is used transiently for Bilibili's own requests within the existing session. The user opens the resulting draft to review and publish it in Bilibili.
```

## 今日头条

适用：`https://mp.toutiao.com/*`、`https://sso.toutiao.com/*`

```text
Read the current Toutiao creator account information, recognize the creator login page, and prepare the user's article in the Toutiao editor with its selected images. The user reviews the prepared editor and completes final publication on Toutiao.
```

## 微博

适用：`https://card.weibo.com/*`、`https://weibo.com/*`、`https://www.weibo.com/*`、`https://passport.weibo.com/*`、`https://login.sina.com.cn/*`、`https://picupload.weibo.com/*`

```text
Identify the user's current Weibo account and login status, prepare either a Weibo article draft or a social post, and upload the user's selected media to Weibo. Article preparation uses Weibo's article editor and image upload service; social-post preparation fills the native composer and file input and observes upload readiness. The user reviews the resulting draft or composer and clicks the final publish control.
```

## 小红书

适用：`https://creator.xiaohongshu.com/*`

```text
Identify the account shown in Xiaohongshu's Creator Center, open the image-post or video-post editor, assign the user's selected media to the native file input, and fill the title, text and tags. Video preparation observes the platform's upload and processing status to show progress. The extension can temporarily open Creator Center for account detection if no suitable tab exists. The user reviews and publishes the prepared post on Xiaohongshu.
```

## 即刻

适用：`https://web.okjike.com/*`

```text
Detect the signed-in Jike account from its existing page or available composer, open the social-post editor, fill the user's text and assign selected images or video to the native file input. Upload progress and the selected circle are shown for user review. If no suitable page exists, the extension temporarily opens the Jike home page for account detection. The user confirms the circle and final publication on Jike.
```

## WeSight 账号服务

适用：`https://api.wesight.ai/*`

```text
Support the extension's WeSight sign-in flow, exchange one-time authorization codes, refresh and revoke tokens, retrieve the user's account display information, and verify membership entitlements for the selected number of publishing platforms. A temporary redirect captures the extension's own sign-in callback. Article text, social-post text, images and videos are not uploaded to the WeSight account service.
```

## X 编辑页与文章草稿

适用：`https://x.com/*`、`https://twitter.com/*`、`https://upload.x.com/*`

```text
Identify the current X account and prepare the user's X article or social-post content. Article preparation uses X's existing web session to upload selected article/cover images to upload.x.com, create an article draft and set its cover through X's web API. Social-post preparation opens X's native text-prefill link and assigns images to the native Post composer file input so X handles their upload. The extension checks existing composer content to avoid overwriting the user's work. It does not perform final publication; the user reviews and publishes on X.
```

## X 公开接口元数据

适用：`https://abs.twimg.com/responsive-web/client-web/*`、`https://abs.twimg.com/responsive-web/client-web-legacy/*`

```text
Fetch publicly available X JavaScript files without login credentials to read the current metadata needed by the X article draft API. The extension only parses operation identifiers, feature names and the public authorization value as text data. Downloaded JavaScript is never evaluated, injected, imported or executed. Request URLs are additionally checked in packaged code against the allowed public script URL patterns. All draft-preparation logic is included in the extension package.
```

## 可选网站权限：文章链接导入

适用：`https://*/*`、`http://*/*`

```text
Request optional website access when the user clicks Import Link to import an article URL they supplied. Users may choose articles from arbitrary websites, and article images or redirects may use separate hosts, so HTTP and HTTPS host access is needed for this import feature. The extension fetches the supplied article, extracts its title and body, downloads its images, and saves the resulting editable draft locally. Article requests use the browser's existing session for that site; image downloads omit login credentials. Imported content is sent to a publishing platform only when the user starts synchronization to that platform. Access is optional and is not requested at installation; refusing it leaves local-file import, direct composition and paired Obsidian workflows available. The extension does not crawl unrelated pages or collect browsing history.
```

## 远程代码字段说明

填写远程代码相关字段时，可使用以下行为说明，并与后台问题的实际措辞核对。

```text
All executable extension code is included in the uploaded package. The extension does not load or execute remotely hosted code. For X article drafts, public JavaScript files are downloaded without login credentials and only parsed for API metadata as data. These files are never evaluated, injected, imported or executed. API responses provide content, account status, membership information or task data; they do not supply executable extension logic.
```
