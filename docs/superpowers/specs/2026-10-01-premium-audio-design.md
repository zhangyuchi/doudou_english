# 精品英音下载与词表发布

Task Mode: design-build。Outcome Status: complete。日期：2026-10-01。

## 目标、证据与约束

用户授权：支持精品语音访问和导入，在 env 文件加入待填写凭证。此前已说明通过北京百炼 Qwen-Audio-TTS 请求 Emily_v3.1，下载到本机再发布；用户本轮要求实施该方案。完成信号是 TXT/CSV/PDF 和无输入补齐均可选择精品模式，完整下载才发布，网页刷新可选择标准或精品英音，env 只追加缺失字段。

Evidence Snapshot：当前 HEAD 17671c4，工作区含已授权未提交的 CLI 导入、动态清单和真实标准版 161 项下载实现。`generateAudio` 管理顺序合成、文件/清单原子提交、生成锁和 WAV/SHA256 复用；`importAliyunList` 管理同一词表发布锁、当前词表和 Vite build；网页目前只有一种阿里云驱动。已有 `.env.local` 含用户配置的标准版凭证，值不能打印或覆盖。Git 状态中的旧改动是本会话前序实现，应保留。

官方证据：[HTTP API](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-http-api)支持北京业务空间域名、Bearer API Key、非流式输出 audio.url、WAV、rate 0.5—2；[音色表](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list)明确 qwen-audio-3.1-tts-flash 的 Emily/Eric/Luna/Luca_v3.1 为英式声音。返回下载地址有效期24小时；只将本地文件和用量数字持久化。服务可用性、账号权限和听感尚未验证；本轮实现验收以模拟协议、真实 WAV 和浏览器测试为范围，实际调用由用户填好凭证后执行。

运行约束沿用 Node >=22.13，跨 Linux/Windows 命令，静态网页无后端、无浏览器密钥。新增依赖为零；PDF 无 OCR、20 MB/100页/2000项规则不变。当前词表指命令发布的 active-list，不代表浏览器独立手动导入数据。远端仍需显式部署。

## 概念、逻辑与决定

品质是 `standard` 或 `premium`。词表是全站唯一已发布 source；音频目录按品质隔离。音频配置是目录内固定的模型/音色/语速/采样率，英文标准化去重后按完整配置索引。词表内容 ID 不含品质；浏览器最后应用的品质标记区分声音切换与词表内容变化。

- LC-1：因为新版模型需要百炼 Bearer 凭证和两步下载，所以生成器新增精品传输分支，沿用原逐项落盘/复用机制。
- LC-2：因为标准与精品配置和计费不同，所以精品写入 `public/audio/aliyun/premium`，版本2清单明确模型/音色/rate/sampleRate，标准版本1不变。
- LC-3：因为本地命令不能读取浏览器数据且所有模式发布同一词表，所以共用根目录 active-list 与 `.import.lock`；无输入读取此 source。
- LC-4：因为同一词表换声音不应丢失错词，所以保留 source ID，新增 lastCliAudioQuality；只在 source 实际变化时清空错词。
- LC-5：因为 API 响应和签名 URL 可能含敏感字段，所以错误只展示本地产生的 HTTP 状态/安全错误码，下载仅允许北京官方 OSS HTTPS 地址且无鉴权头，签名地址不存清单。

Decision Log：选择既有生成器增加品质分支和版本2清单。另建完整精品生成器会重复锁/断点/WAV逻辑；直接把精品写入标准目录会混声且破坏配置兼容。以后支持其他模型或地域时重新评估，当前只支持一个明确模型及四种官方英音。架构检查选择持久化兼容、生成产物所有权、凭证边界、失败恢复；其余流程按现有播放器生命周期实现。

## 接口、数据与处理

`audio:aliyun` 和 `import:aliyun` 新增 `--quality premium`；默认 standard。精品 `--voice` 默认 Emily_v3.1，可选 Eric/Luna/Luca_v3.1；`--rate` 0.5—2，默认1；精品拒绝 `--speech-rate`，标准拒绝 `--rate`，避免误配置。预览无网络无写入，精品不套用标准按次价格，成功输出本次 input/output Token 数。

精品清单 `{version:2, model:'qwen-audio-3.1-tts-flash', voice, rate, sampleRate:24000, entries}`，条目沿用 english/file/sha256/bytes/generatedAt，并可包含有效非负 usage 数字。文件名哈希包含全部配置；模型或声音配置不匹配时在请求前失败。版本1清单及标准文件名保持兼容。env 增加 `DASHSCOPE_API_KEY` 和 `DASHSCOPE_WORKSPACE_ID`；现有键不覆盖，文件继续忽略且权限600。

精品先 POST 到 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`，JSON input含全文、WAV、24kHz、rate；确认 finish_reason=stop，再取 audio.url 下载。HTTP/JSON错误、缺URL、非北京OSS地址、取消或坏WAV不发布条目；HTTP URL升为HTTPS，禁止重定向。使用API Key只请求百炼域名，下载请求不带它。保留30秒请求超时、顺序执行和禁止自动重试策略；失败重跑复用已成功项目。

词表成功发布到根 active-list 时加可选 `audioQuality`，旧文件视为 standard。CLI整个生成/发布/build持有根锁，两种品质不能同时覆盖当前词表。无输入沿用所选品质目录已有配置；没有已发布词表才回退builtin，坏词表报错。

网页每次刷新独立读取两份清单，某份损坏只影响该品质；加载根词表后按 audioQuality 验证覆盖并自动选择对应声音。同内容换品质保留错词、更新品质标记；重复发布相同内容及品质保持手动选择。旧snapshot缺失lastCliAudioQuality视为standard；受保护快照不自动改写。两驱动都有播放取消职责，缺词不切换声音。可选404豁免只扩展到精品manifest，其他错误继续检查。

## 承诺、变更与验证

| 承诺                                                | 变更组                                   | 验证                                                                      |
| --------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| DC-1 正确请求精品并私下保存，可恢复失败，无凭证泄露 | CHG-1 生成器传输、版本2清单、env         | V-1 协议/URL/响应/锁/配置/校验和/取消及错误用量测试                       |
| DC-2 三种文件和无输入通过同一锁发布完整词表         | CHG-2 CLI 品质路由、当前词表、发布元数据 | V-2 文件解析、根锁、精品失败保留标准source、成功覆盖、配置继承            |
| DC-3 标准与精品可选，同内容换品质保留错词           | CHG-3 网页多驱动及storage标记            | V-3 真实WAV浏览器播放、同词表品质切换/刷新/手动选择/坏清单隔离            |
| DC-4 用户只需填两字段，构建不携带密钥               | CHG-1/2/3及说明                          | V-4 env仅追加检查、预览无API、npm test/build/browser/format、模拟凭证检查 |

## 账本、风险与完成

Issues List：无 open issue。Blocks List：无 open block。Follow-ups：填好北京百炼凭证后真实合成和人工试听；本轮不执行未配置的精品付费请求。Accepted Risks：精品用量预览无法给出输出Token，真实账户费用以usage/账单验收；完整收到的HTTP响应不证明发音准确。Plan B：继续使用已下载标准版，失败不覆盖标准目录和词表。

最终追踪为用户授权 → 官方协议和本地证据 → LC-1—5 → DC-1—4 → CHG-1—3 → V-1—4。V-1/2 的生成、续传、取消、两级锁和导入测试通过；V-3 的真实 WAV 模拟浏览器测试覆盖品质切换、错词保留、刷新及损坏隔离。V-4 确认 env 原内容保留、忽略规则和权限600，构建不含凭证，精品预览不访问服务。全部68项测试、10项Chromium回归、构建、两种部署检查及格式/空白检查通过。本地复核已完成；真实精品服务和人工音质验证保留为凭证填写后的试用项，详见[验证记录](../../verification.md)。
