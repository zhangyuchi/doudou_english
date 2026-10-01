# 用阿里云生成个人学习英音

本功能用于自己的英语学习。生成脚本在电脑上调用阿里云一次并保存 WAV 文件；网页练习时播放本地文件，不再调用语音 API，也不需要凭证。当前支持 Emily 英式女声（`emily`）、Eric 英式男声（`eric`），与项目已有的英国英语要求一致。

使用流程：开通语音合成并配置本机凭证 → 根据词表生成音频 → 保存文件及清单 → 网页按英文内容匹配播放。新词需要再次生成；已保存且校验通过的词会直接复用。

如果希望**词表和声音一起发布到本机网站**，使用新命令：

```bash
npm run import:aliyun -- --input /path/to/words.txt
npm run import:aliyun -- --input /path/to/words.txt --execute
```

输入也可以是 UTF-8 CSV 或具有文字层的中英 PDF。第一条只预览分组、词数、已有和待生成数量，不调用 API 或改动网站；第二条才请求缺失声音。成功后命令写入 `public/audio/aliyun/active-list.json` 并重建本机 `dist`。已运行的 `npm run dev` 无需重启，刷新网页即可看到新词表并使用阿里云英音；本机 `dist` 静态服务在构建完成后刷新也会更新。远程站点还需另行发布新构建产物，本地命令不会自动上传到远程服务器。

**不带 `--input` 时，补齐当前已发布词表的阿里云英音：**

```bash
npm run import:aliyun
npm run import:aliyun -- --execute
```

第一条只预览；第二条下载缺失或损坏的文件，校验通过的已有阿里云文件会跳过。当前词表取自 `public/audio/aliyun/active-list.json`，尚未发布过则使用内置 161 项词表；沿用已有阿里云清单的音色和语速，没有清单时用 Emily、语速 0。补音频不会改变原已发布词表的版本或重置其错词记录。预置的 Piper 音频属于另一套声音，不计作已有阿里云文件。

网页手动导入的词表只保存在该浏览器的本地存储中，命令无法读取。要处理这份词表，首次需要用 `--input` 指定同一文件。已发布文件损坏时命令报错停止，不会退回内置词表并调用服务。

PDF 使用和网页相同的文字与留白分组识别，不含 OCR。多栏、表格或特殊排版可能识别不准；付费执行前，建议先在网页导入该 PDF 检查预览，必要时整理为 TXT/CSV。单组超过 15 项时按 15 项分组。文件最多 20 MB、PDF 最多 100 页、词表最多 2000 项。

新命令在生成与构建期间持有 `.import.lock`，避免两个词表发布任务交错。正常完成或失败会自动释放；断电后如遗留锁，确认没有导入进程正在运行，再手动移除 `public/audio/aliyun/.import.lock`。音频逐项生成的 `.generate.lock` 仍由原生成脚本管理。

## 1. 开通服务并准备凭证

1. 在[智能语音交互控制台](https://nls-portal.console.aliyun.com/)开通普通「语音合成」。新用户可先试用；需要付费时升级商用版并充值阿里云余额。
2. 在「全部项目」创建「仅语音合成」项目，复制项目 Appkey。
3. 准备有智能语音交互权限的 RAM 用户 AccessKey ID / Secret。脚本按[官方 Token 文档](https://help.aliyun.com/zh/isi/user-guide/obtain-an-access-token)通过 `@alicloud/pop-core` 调用上海 `CreateToken`；Token 仅保存在内存中，按返回的 ExpireTime 刷新。
4. 在项目目录运行：

```bash
npm ci
cp .env.example .env.local
```

用编辑器填写 `.env.local`，不要把真实密钥粘贴到聊天或提交到 Git：

```dotenv
ALIYUN_NLS_APPKEY=你的项目Appkey
ALIYUN_AK_ID=你的AccessKeyID
ALIYUN_AK_SECRET=你的AccessKeySecret
ALIYUN_NLS_TOKEN=
```

也可只填 Appkey 和从控制台获取的临时 `ALIYUN_NLS_TOKEN`，省略两项 AccessKey。填写 Token 后优先使用它；过期会停止，需更换或清空该字段后使用 AccessKey 自动申请。这里不是百炼 API Key，不需要 `sk-` 凭证。`.env.local` 和生成音频目录均被 Git 忽略，不要将密钥命名为 `VITE_...`。

## 2. 先预览，再生成

下列 `audio:aliyun` 示例使用标准版。精品模式见文末[精品英音](#精品英音百炼)。

预览内置 161 项，无需凭证，也不会发起网络请求：

```bash
npm run audio:aliyun
```

确认待生成数量后执行：

```bash
npm run audio:aliyun -- --execute
```

按 3.50 元／千次的普通语音合成起步价估算，首次生成内置 161 项约 0.5635 元。实际按阿里云试用、资源包及账单计算；预览不是供应商报价。价格和规则见[计费项](https://help.aliyun.com/zh/isi/getting-started/pricing)及[收费标准](https://help.aliyun.com/zh/isi/getting-started/billing-10)。每个完整词或短语单独请求，当前词表验证限制每项不超过 100 个字符；不拆词拼接。

自己的 TXT 或 CSV 词表使用和网页相同的格式：

```bash
npm run audio:aliyun -- --input public/examples/words.txt
npm run audio:aliyun -- --input public/examples/words.txt --execute
npm run audio:aliyun -- --input public/examples/words.csv --execute
```

TXT 一行一个英文单词或短语，中文以 Tab 分隔，空行分组。CSV 为英文、中文、可选组号，支持 `english,chinese,group` 表头。格式示例见[导入指南](word-list-import.md)。脚本保留完整短语，标准化英文后去重；最多 2000 项、20 MB。PDF 需先整理成 TXT/CSV。

可指定 Eric 或调慢语速：

```bash
npm run audio:aliyun -- --voice eric --speech-rate -100
npm run audio:aliyun -- --voice eric --speech-rate -100 --execute
```

默认语速为 0；范围 -500～500。首次选定配置后，不同音色或语速会被拒绝写入同一目录。要换一套配置，先备份并移走 `public/audio/aliyun`，再执行生成。

## 3. 保存位置与失败恢复

输出目录：

```text
public/audio/aliyun/
  manifest.json        # 标准化英文、文件名、音色、语速、SHA256、大小、生成时间
  <64位哈希>.wav       # 对应单词或完整短语的声音
```

脚本逐项生成，检查 HTTP 状态、音频类型和 WAV 结构后，原子写入文件，再提交清单；清单不包含凭证。后续输入新词表会扩充同一清单，不删除先前词表音频。

阿里云流式 WAV 头使用预估长度，可能与实际数据大小不同，见[官方 FAQ](https://help.aliyun.com/zh/isi/support/faq-about-speech-synthesis)。脚本完整接收响应后，对标准 PCM WAV 头修正 RIFF/data 长度，再严格校验保存；已保存文件的复用仍校验原始文件结构和 SHA256，不自动修复磁盘损坏文件。

已下载的 WAV 是普通本地文件，脚本不会设置有效期或定时删除。NLS Token 过期只影响后续 API 请求，不影响这些文件的播放；重复练习不会产生新的语音合成请求费用。长期保留时应备份整个目录，包括 `manifest.json`，网页需要它来匹配英文和文件名。此处描述的是本项目的保存及播放机制，使用范围仍受下文引用的服务协议约束。

中途失败会停止，并显示当前词和安全错误码。直接重新执行原命令即可：已有、配置一致且校验通过的文件会跳过；缺失或损坏的文件重新生成。脚本不自动重试合成请求，因为超时可能已在服务端收费。成功文件写入后、清单写入前若意外退出，重跑可能对该未索引项再次收费。

同一目录只允许一个生成任务。正常退出或 Ctrl+C 会释放 `.generate.lock`；断电或强制杀进程可能留锁。只有确认没有生成进程正在运行后，才手动删除目录内的 `.generate.lock` 并重跑。不要同时生成音频和运行构建/发布。

## 4. 在网页播放

尚未启动开发服务器时运行：

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

网页声音下拉框会增加「阿里云英音 · Emily · 英式女声」或对应 Eric 选项。选中后点击单词或播放按钮即可；试听使用当前可播放的词，整组听写会先检查覆盖数量。未生成的词保持禁用，不会自动改用其他声音。

单独运行 `audio:aliyun` 时，自定义词表仍需在网页手动导入；该脚本只生成音频，不改变浏览器中的词表或错词记录。新增音频后刷新网页即可读取最新清单。运行 `import:aliyun -- --input ... --execute` 会在声音完整时自动发布新词表；后续可省略 `--input` 补齐这份词表的声音。

构建个人使用的静态站点：

```bash
npm run build
```

网页每次加载时读取同站清单，音频会随 `dist` 一起打包。浏览器只接收文件索引、已发布词表和音频，不接收 AccessKey 或 Token；当前公开源代码仓库不会包含这些被忽略的私人音频。可备份整个 `public/audio/aliyun` 目录以便以后重建。新命令发布不同词表后，网页会替换当前词表、清空旧错词并选中阿里云英音；同一词表重复刷新保留错词。手动切回内置词表后，同一已发布版本不会反复覆盖你的选择。

阿里云文件仅用于个人学习，不沿用现有 Piper/Commons 文件的开放许可，也不加入原「来源与许可」清单。[商业短文本服务协议第 2.5 条](https://help.aliyun.com/zh/isi/support/intelligent-speech-synthesis-and-agreement-for-the-service-improvement-plan)限制个人或企业内部使用；包含这些文件的 `dist` 不应发布为对外提供音频的网站。

## 验证边界

自动测试使用模拟 API 返回的真实 WAV，验证去重、协议字段、断点恢复、错误不落盘、锁、Token 缓存、WAV 格式校验、SDK 调试日志凭证隔离、构建和浏览器匹配/播放。68 项测试和 10 项 Chromium 浏览器回归通过；完整记录见[验证记录](verification.md)。2026-10-01 使用本机 Appkey 和临时 Token 成功生成全部 161 项标准版 Emily 英音；重跑预览确认已有 161 项、待生成 0 项。精品协议通过模拟响应验证，真实精品请求待填写百炼凭证后执行。没有人工核对所有单词音质、实际账单或真实 iPad。

第一次建议只用 3～5 个单词生成和试听，再处理全表。`read`、`lead`、`tear` 等同形异音词要人工核对；当前按英文匹配一份声音，不保证自动选择对应释义的读音。

## 精品英音（百炼）

精品模式使用北京百炼 `qwen-audio-3.1-tts-flash`，支持 `Emily_v3.1`、`Eric_v3.1`、`Luna_v3.1` 和 `Luca_v3.1`，均为英式英语；音色名区分大小写。默认 Emily、语速1、24 kHz WAV。本项目依据[官方音色表](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list)和[HTTP接口](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-http-api)，接入这一模型及北京地域。

### 填写配置

在阿里云百炼控制台选择「华北2（北京）」，创建有该模型调用权限的 API Key，并复制同一业务空间的 Workspace ID。参考[获取API Key](https://help.aliyun.com/zh/model-studio/get-api-key)和[获取Workspace ID](https://help.aliyun.com/zh/model-studio/obtain-the-app-id-and-workspace-id)。在本机 `.env.local` 填写已预留的两字段：

```dotenv
DASHSCOPE_API_KEY=你的北京百炼APIKey
DASHSCOPE_WORKSPACE_ID=你的北京业务空间ID
```

原有 `ALIYUN_NLS_*` 和 AccessKey 字段继续用于标准版。已有 `.env.local` 时直接编辑，勿用示例文件覆盖它；两种服务的凭证分别读取。网页不调用合成服务，也不读取这些字段。

### 预览、下载与导入

```bash
# 当前已发布词表；未发布过则使用内置词表
npm run import:aliyun -- --quality premium
npm run import:aliyun -- --quality premium --execute

# 新词表，支持 TXT、CSV 或文字版中英 PDF
npm run import:aliyun -- --quality premium --input "/path/to/words.pdf"
npm run import:aliyun -- --quality premium --input "/path/to/words.pdf" --execute
```

预览无凭证可用、不发请求或写文件。执行先请求合成，再立即下载返回地址的 WAV，校验后保存至 `public/audio/aliyun/premium/`。全部音频完整后才发布根目录 `active-list.json`，标记精品品质并重建 `dist`；刷新本地网页自动选中「阿里云精品英音」。原标准版目录和文件保留，在声音选择器可随时切换。相同词表切换品质不清空错词；重复发布相同词表与品质不覆盖后续手动选择。

不带 `--input` 时沿用精品目录已有音色和语速。首次可指定 Eric 和慢语速：

```bash
npm run import:aliyun -- --quality premium --voice Eric_v3.1 --rate 0.8 --execute
```

精品语速 `--rate` 范围0.5～2，默认1；标准版沿用 `--speech-rate`，两种参数不可混用。同一品质目录不允许混入不同配置。想更换精品音色或语速时，先备份并移走 `public/audio/aliyun/premium/` 再生成；无需移动标准版目录。

只生成声音、不发布词表时，可用 `npm run audio:aliyun -- --quality premium --execute`；它只读取内置词表或指定TXT/CSV。自动词表导入、PDF及当前词表补齐使用 `import:aliyun`。

### 计费、保存与恢复

精品按实际输入/输出 Token 计费，预览只给待生成项数，不套用标准按次报价。成功后输出本次可统计的 Token 数；清单条目保存有效用量数字，不保存API Key或签名下载地址。最新费率和试用额度以[模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)及账号控制台为准。

接口返回的下载地址有效期24小时，命令立即下载并保存；本地文件不会随地址过期。下载只允许北京阿里云OSS地址，使用HTTPS且不携带API Key；API Key只发送到所配置的百炼业务空间域名。网络、下载、取消或坏音频会停止，已完成条目保留，重跑只补缺失/损坏文件；合成请求不自动重试。所有项未完整时不发布新词表，两种品质导入共用发布锁。

精品清单版本2记录模型、音色、语速和采样率；旧标准版本1继续可用。未生成精品清单时网页保留现有声音；某品质清单损坏会显示错误，另一品质仍可使用。同时只提供一套标准和一套精品配置。
