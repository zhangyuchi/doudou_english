# 用阿里云生成个人学习英音

本功能用于自己的英语学习。生成脚本在电脑上调用阿里云一次并保存 WAV 文件；网页练习时播放本地文件，不再调用语音 API，也不需要凭证。当前支持 Emily 英式女声（`emily`）、Eric 英式男声（`eric`），与项目已有的英国英语要求一致。

使用流程：开通语音合成并配置本机凭证 → 根据词表生成音频 → 保存文件及清单 → 网页按英文内容匹配播放。新词需要再次生成；已保存且校验通过的词会直接复用。

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

已下载的 WAV 是普通本地文件，脚本不会设置有效期或定时删除。NLS Token 过期只影响后续 API 请求，不影响这些文件的播放；重复练习不会产生新的语音合成请求费用。长期保留时应备份整个目录，包括 `manifest.json`，网页需要它来匹配英文和文件名。此处描述的是本项目的保存及播放机制，使用范围仍受下文引用的服务协议约束。

中途失败会停止，并显示当前词和安全错误码。直接重新执行原命令即可：已有、配置一致且校验通过的文件会跳过；缺失或损坏的文件重新生成。脚本不自动重试合成请求，因为超时可能已在服务端收费。成功文件写入后、清单写入前若意外退出，重跑可能对该未索引项再次收费。

同一目录只允许一个生成任务。正常退出或 Ctrl+C 会释放 `.generate.lock`；断电或强制杀进程可能留锁。只有确认没有生成进程正在运行后，才手动删除目录内的 `.generate.lock` 并重跑。不要同时生成音频和运行构建/发布。

## 4. 在网页播放

生成完成后，重启开发服务器：

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

网页声音下拉框会增加「阿里云英音 · Emily · 英式女声」或对应 Eric 选项。选中后点击单词或播放按钮即可；试听使用当前可播放的词，整组听写会先检查覆盖数量。未生成的词保持禁用，不会自动改用其他声音。

自定义词表还需在网页导入同一份 TXT/CSV；脚本只生成音频，不改变浏览器中的词表或错词记录。新增音频后需再次重启开发服务器；已有运行页面不会自动读取新的清单。

构建个人使用的静态站点：

```bash
npm run build
```

Vite 在启动/构建时读取可选清单，音频会随 `dist` 一起打包。浏览器只接收文件索引和音频，不接收 AccessKey 或 Token；当前公开源代码仓库不会包含这些被忽略的私人音频。可备份整个 `public/audio/aliyun` 目录以便以后重建。

阿里云文件仅用于个人学习，不沿用现有 Piper/Commons 文件的开放许可，也不加入原「来源与许可」清单。[商业短文本服务协议第 2.5 条](https://help.aliyun.com/zh/isi/support/intelligent-speech-synthesis-and-agreement-for-the-service-improvement-plan)限制个人或企业内部使用；包含这些文件的 `dist` 不应发布为对外提供音频的网站。

## 验证边界

自动测试使用模拟 API 返回的真实 WAV，验证去重、协议字段、断点恢复、错误不落盘、锁、Token 缓存、WAV 格式校验、SDK 调试日志凭证隔离、构建和浏览器匹配/播放。56 项测试和 8 项 Chromium 页面回归通过；完整记录见[实现与验证记录](superpowers/specs/2026-09-30-aliyun-audio-design.md#验证与审查结果)。没有真实阿里云凭证，尚未验证账号授权、实际合成音质、费用或真实 iPad。

第一次建议只用 3～5 个单词生成和试听，再处理全表。`read`、`lead`、`tear` 等同形异音词要人工核对；当前按英文匹配一份声音，不保证自动选择对应释义的读音。
