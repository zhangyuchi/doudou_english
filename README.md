# 听写时光

适合 iPad Safari 的英音听写网页：网页朗读，学生在纸上写答案。内置外研社七年级词表，共 11 组、161 项。默认播放随网站提供的英音文件，不依赖操作系统的语音库；支持现代 iPad Safari、Android、Windows、macOS 和 Linux 浏览器。不是原 PDF 的教材录音。

## 在电脑启动，用 iPad 打开

电脑需要 Node.js 22.13 或更新版本。终端进入此项目目录后运行：

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 5173
```

电脑和 iPad 连接同一个 Wi-Fi。查看终端输出的 `Network` 地址，在 iPad Safari 打开，例如 `http://192.168.3.52:5173/`（以当前电脑地址为准）。电脑须保持运行。无法访问时检查两台设备的网络和电脑防火墙。

在页面选择英国英语声音，点击“试听”；然后选一组，复习或开始听写。默认每词朗读 1 次、书写间隔 10 秒，次数可选 1/2/3，间隔可选 5/8/10/15 秒或自定义 1—60 秒。间隔从最后一遍实际朗读结束后开始。

朗读中暂停后，继续会重读未读完的这一遍；倒计时中暂停则保留剩余时间。切到后台会暂停，返回页面后点击继续。

## 部署到静态网站

自有 Linux 服务器可以使用项目的 SSH 发布脚本：

```bash
cp deploy.config.example.json deploy.config.json
# 编辑 deploy.config.json，填写自己的服务器与应用专用目录
npm run deploy -- --dry-run
npm run deploy
```

支持版本列表与回滚，不绑定 Nginx；Python 内网试用、Nginx/Caddy 配置、权限和失败恢复见[服务器部署指南](docs/deployment.md)。服务器前置准备需先按指南完成。脚本不会自动安装 Web 服务。

手动部署仍可使用：

```bash
npm run build
```

将 **dist 目录内的全部文件**上传到静态网站的发布目录，保留子目录结构。网站根目录或子路径均可；页面、PDF worker、字体和样例词表都已包含在 dist 中，不需要上传 node_modules 或原音频 PDF，也不需要后端服务、数据库或语音 API 密钥。

部署前本地查看构建产物：

```bash
npm run preview -- --host 0.0.0.0 --port 5173
```

iPad 同样访问电脑的 `http://电脑局域网地址:5173/`。正式网站部署后访问正式网址，不依赖电脑保持运行。第一版不提供离线缓存；不要直接在“文件”应用中打开 index.html，需通过网页地址访问。

## 导入自己的词表

iPad 操作步骤、PDF 支持范围、UTF-8 TXT/CSV 示例、分组和保存注意事项见[单词文件导入指南](docs/word-list-import.md)。可直接参考 [TXT 样例](public/examples/words.txt)与 [CSV 样例](public/examples/words.csv)。

点击“导入”，选择文件，核对可编辑预览后点击“确认使用词表”。解析失败或取消时，当前词表保持不变。确认导入会替换当前词表，并清空上一份词表的错词记录；页面有明确提示。

支持以下格式：

- **文字版中英词表 PDF**：支持随项目附带的当前词表（`public/examples/外研社7年级英语听写分组.pdf`）及相似排版。保留单词、短语、中文和留白分组，忽略空白页。不同排版可能需要在预览中修正；扫描件需要先做 OCR。只有编号和音频入口的 PDF 不能提供词表。
- **TXT**：一行一个英文单词或短语，可在英文后以 Tab 分隔中文；空行分组。只有英文也可以。
- **CSV**：列顺序为英文、中文、可选组号；支持 `english,chinese,group` 表头，中文中的逗号用双引号包住。

TXT 示例（英文与中文之间是 Tab）：

```text
hello	你好
primary school	小学

point out	指出
```

CSV 示例：

```csv
english,chinese,group
hello,你好,1
primary school,小学,1
point out,"指出,指明",2
```

单组超过 15 项时导入预览默认按 15 项分组，也可点击“每 15 项重新分组”或手动改空行。每份文件最多 20 MB、100 页、2000 项。文件仅在浏览器内读取，不上传到服务器。

## 英音、错词与记录

默认“预置英音”覆盖内置 161 项，资源随网站部署，练习时不调用第三方语音服务。首次点击开始或试听会解锁浏览器音频；切后台会暂停，回前台需手动继续。来源、作者、逐文件许可和生成参数见网站页脚“来源与许可”及 [音频说明](docs/audio.md)。

可主动选择设备实际提供的 `en-GB` 系统英音。导入的新词按英文内容匹配预置目录：已收录项直接复用，未收录项会显示覆盖数量并阻止整组预置听写；可选系统英音或由维护者补充录音。不会自动换声音、跳过缺词或把长短语拆词拼接。

个人学习还可[使用阿里云生成本地英音](docs/aliyun-audio.md)。已有 `npm run audio:aliyun` 只生成声音；新命令 `npm run import:aliyun -- --input 词表.txt` 先预览 TXT、CSV 或文字版中英 PDF，配置本地凭证后加 `--execute` 才生成音频并发布词表。本机网页刷新后自动显示新词表、选中「阿里云英音」；练习时无需调用 API。私人音频不采用上述开放许可。

省略 `--input`：`npm run import:aliyun -- --execute` 补齐当前已发布词表缺失或损坏的阿里云音频，并复用已有音色、语速和有效文件。尚未发布词表时使用内置词表；网页手动导入的浏览器本地词表仍需首次通过 `--input` 指定文件。不加 `--execute` 仅预览。

精品英音使用 `npm run import:aliyun -- --quality premium` 预览，填好 `.env.local` 中北京百炼的 `DASHSCOPE_API_KEY` 和 `DASHSCOPE_WORKSPACE_ID` 后加 `--execute` 下载并发布。默认 `qwen-audio-3.1-tts-flash` / `Emily_v3.1`，也支持 Eric、Luna、Luca 的精品英音；`--input` 仍可接 TXT/CSV/PDF。精品文件单独保存，网页可选择标准或精品英音，同一词表切换品质保留错词。详见[精品英音接入](docs/aliyun-audio.md#精品英音百炼)。

现代浏览器可播放同一份音频，但不承诺所有旧 OS/浏览器。不同说话者的音色、重音和教材原录音可能不同，自动解码测试不能替代实际听感核对。真实 iPad/Android 的音质、音频解锁及后台/锁屏行为仍需设备试用。

核对纸上答案后，勾选错词，点击“错词复习”单独练习；取消勾选即可移除已掌握词。设置、当前词表和错词保存在当前浏览器、当前网站地址下，不跨设备同步。浏览器清理网站数据会清除记录；切换网站域名或端口也会形成另一份记录。

保存失败会显示提示，本次仍可练习。损坏的历史记录会保留，页面暂用内置词表，点击“替换损坏记录并保存”才覆盖历史记录。

## 开发验证

```bash
npm test
npx playwright install chromium webkit
npm run test:browser
npm run build
npm run test:deploy
npm run test:deploy:python
npm run format:check
```

Linux 上 Playwright 的 WebKit 还需要系统依赖，按 `npx playwright install-deps webkit` 的指引准备。仅跑 Chromium 可使用 `npm run test:browser -- --project=chromium-ipad`。测试环境也可通过 `IPAD_WEBKIT_EXECUTABLE` 指定兼容的 WebKit 启动程序。

test:deploy:python 额外需要 Python 3.9+，验证内置 HTTP 服务、真实 PDF 导入和 current 切换；不使用 Python 托管时可跳过此项。部署脚本测试包含实际本地构建和 Bash 临时目录验证，执行 npm test 时不要同时发布或运行其他构建。

浏览器测试在 iPad 尺寸下验证真实预置音频播放与连续推进，并用可控系统语音验证备用声音；另验证页面、取消、保存和实际 PDF 解析；不能代替真实 iPad 的声音质量与后台行为测试。实现和验证边界见 [设计说明](docs/design-contracts.md) 与 [验证记录](docs/verification.md)。
