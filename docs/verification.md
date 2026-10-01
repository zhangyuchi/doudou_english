# 验证记录

## 2026-10-01 iPad 预置与阿里云录音无声

用户报告本机Chrome可播放，iPad Safari/Chrome只有系统声音有声，预置与阿里云录音都无声。共同组件 `BundledAudio.unlock` 现在在点击同步阶段、AudioContext创建/resume之前，检测可选 `navigator.audioSession` 并指定 `playback`。文件、凭证、清单与播放器生命周期均未改变。依据[WebKit记录](https://bugs.webkit.org/show_bug.cgi?id=237322)和[W3C工作草案](https://www.w3.org/TR/audio-session/)，这是针对默认Web Audio媒体会话的兼容修复；不能由该现象断言所有设备静音或失败原因相同。用户刷新后明确确认iPad已恢复有声。

Implementation mode，本地复核，无独立审查代理。`node --test --test-name-pattern='media session' tests/audio.test.js` 两项测试先失败后通过，覆盖同步媒体路由、缓存复用、实际结束与配置失败不推进。`npm run test:browser -- --project=chromium-ipad --grep 'bundled and Aliyun'` 新增一项回归通过，使用模拟媒体会话及真实Web Audio/WAV，覆盖预置与标准阿里云两驱动。`npm run build`通过；格式与空白检查通过。WebKit初次运行因缺少libevent等运行库未启动，临时依赖已补齐；后续完整测试/双浏览器调用被用户中断，未读取最终结果，不声称通过。浏览器仍有颜色环境变量冲突警告，来源未验证。用户真机确认后停止额外全量回归和161项重复解码。

## 2026-10-01 精品英音接入

代码质量模式：Implementation mode；完成生成器、导入发布、网页兼容及凭证边界的本地复核，未使用独立审查代理。新增 `--quality premium`，默认 Emily_v3.1，音频保存到独立目录；TXT/CSV/PDF 继续使用原解析流程，无输入时读取当前已发布词表。标准声音保持可用，同内容切换品质保留错词。

本次验证：`npm test` 68/68、`npm run test:browser -- --project=chromium-ipad` 10/10 通过；`npm run build`、`npm run test:deploy`、`npm run test:deploy:python`、`npm run format:check` 和 `git diff --check` 通过。两种部署检查继续覆盖 161 项真实预置音频解码、播放、PDF 与 worker；精品路径的浏览器验证使用模拟 API 响应及有效 WAV。

新增测试覆盖精品 POST 与下载两步协议、鉴权头隔离、签名地址不持久化、不可信下载地址拒绝、错误凭证不回显、配置不匹配、失败续传、生成与发布锁、取消、Token 用量、同词表品质切换、刷新保持手动音色及损坏清单隔离。生成器、导入与页面测试分别观察到实现前失败，再通过。

`.env.local` 仅追加 `DASHSCOPE_API_KEY` 和 `DASHSCOPE_WORKSPACE_ID` 空字段，原内容保留；确认该文件被 Git 忽略且权限为 600，构建 JS/HTML 不含已配置凭证。精品无凭证预览显示 11 组、161 项待生成，标准预览仍有 161 项可复用；没有发起真实精品请求。

真实精品账号权限、账单和人工听感待填好北京百炼凭证后验证；本轮没有 Windows 或实体设备验收。PDF 测试的损坏样例触发 PDF.js 索引提示，浏览器环境仍有颜色变量冲突警告，测试未因此失败。

## 2026-10-01 真实阿里云下载及流式 WAV 修复

用户配置 Appkey 与临时 Token 后，执行 `npm run import:aliyun -- --execute`。初次联网请求返回 HTTP 200、`audio/mpeg`，但 `without` WAV 实际 23082 字节，头声明的 RIFF/data 长度为 153636/153600，触发原严格校验。诊断与[阿里云官方 FAQ](https://help.aliyun.com/zh/isi/support/faq-about-speech-synthesis)的流式预估长度说明一致。

修复仅作用于完整读取的成功响应中标准 44 字节 PCM WAV 头；校正长度后再按原严格校验落盘。已保存文件不做头修复，结构或校验和损坏仍重新生成。新增测试先复现失败再通过，覆盖预估长度大于/小于实际、样本不变、磁盘截断、半采样帧及空声音拒绝。全部 `npm test` 63/63、格式与空白检查通过；修复范围在本地审查，未使用独立审查代理。

真实执行成功下载外研社七年级英语 11 组、161 项 Emily 英式女声音频，语速 0，共 3,553,962 字节。词表与清单写入 `public/audio/aliyun` 并完成 `dist` 构建；无参数预览确认已有 161 项、待生成 0 项，全部文件通过 WAV 和 SHA256 复用校验。凭证未输出或写入清单。临时 Chromium 检查本地真实构建的自动词表、音色、全部 161 项解码及试听；尚未人工核对所有读音、实际费用或实体设备。

## 2026-10-01 本地词表与阿里云音频命令

新增 `import:aliyun`，读取 TXT、CSV 或文字版中英 PDF，调用原有生成器并在所有词有音频后发布词表；网页刷新时从同站静态目录读取最新阿里云清单和词表。模拟测试覆盖失败不发布、断点复用、单任务锁、同源刷新保留错词、手动切换与新词表替换。

本次验证：`npm test` 62/62 通过；`npm run test:browser -- --project=chromium-ipad` 9/9 通过；`npm run build`、`npm run test:deploy`、`npm run test:deploy:python` 和 `npm run format:check` 通过。真实样例 PDF 在 CLI 解析出 11 组 161 项；无凭证预览未调用 API。浏览器和静态站点测试使用模拟阿里云响应的有效 WAV，验证自动词表与声音播放，且前端 JS 不包含模拟凭证。

补充无 `--input` 模式后重跑全部 62 项测试，覆盖内置词表回退、已发布词表缺失及损坏音频修复、音色语速继承、词表版本保持、无凭证复用和损坏词表禁止请求；实际无参数预览得到 11 组 161 项且未调用 API。该补充只重跑单元/集成测试、构建与格式检查，独立的 9 项浏览器回归及部署检查沿用此前结果。

空站点没有私人音频清单时，运行时请求可选的 `manifest.json` 和 `active-list.json` 会收到预期 404；部署检查只豁免这两个可选路径，其他 HTTP 错误仍失败。受限沙箱不允许本地 HTTP 服务监听端口，相关测试在获准的沙箱外执行。Chromium 测试环境仍提示 `NO_COLOR` 与 `FORCE_COLOR` 冲突，未验证警告来源。未调用真实阿里云账号或在实体 iPad、Windows 设备试用；远程站点仍须单独发布构建产物。

## 2026-09-29 预置英音改造

本次工作区验证：`npm test` 44 项通过；`npm run test:browser -- --project=chromium-ipad` 8 项通过；`npm run build`、`npm run test:deploy`、`npm run test:deploy:python`、`npm run format:check`、`git diff --check` 通过。

- 全部 161 项覆盖、来源字段、文件 SHA256、PCM WAV 结构和非静音信号通过检查，总音频 5,516,426 字节。当前为 4 项真人录音、157 项 Piper Cori high 合成；下载限流的候选文件未计入交付。
- 浏览器使用真实 Web Audio 连续播放预置音频，验证没有 `speechSynthesis` 也能从第一项推进到第二项；备用系统声音仍使用可控模拟。
- `/practice/` 子路径与真实 Python HTTP 服务分别解码全部 161 个文件，执行试听及正式播放，并保留 PDF.js 真实导入、原子版本切换验证。
- 可控时钟及音频驱动覆盖取消后迟到完成、加载/解码取消、启动失败清理、重复与书写间隔、暂停续播、试听不替换队列/设置、缺词整组禁止启动、声音刷新保留暂停。
- 本次未安装/运行 WebKit，也没有实体 iPad/Android 听感、锁屏或后台音频解锁验收；可解码与推进不证明教学发音完全正确，不声称兼容全部历史 OS。

以下为第一版历史验证记录，不能当作本次 WebKit/实体设备验证。

日期：2026-09-28。代码质量模式：Implementation mode，完成时对全部新增代码、测试、依赖、样例、构建脚本和文档做本地复核。没有既有代码、Git 工作区或独立评审者；不声称经过独立代码评审。

## 已运行

| 命令                                                                                           | 结果                                  | 覆盖                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                                     | 18 项通过                             | V-1/2/3：真实 PDF 的 11 组161项、短语、CSV/TXT、次数1/2/3、间隔、暂停、取消、重播、失败、快照损坏和保存失败                  |
| `IPAD_WEBKIT_EXECUTABLE=/tmp/ipad-dictation-webkit-libs/launch-webkit.sh npm run test:browser` | 10 项通过，Chromium 5 项、WebKit 5 项 | V-1/3/4：iPad尺寸横竖屏、英音筛选、真实PDF浏览器导入、取消导入、刷新恢复、错词移除、输入文本不执行HTML、无英音、损坏记录保护 |
| `npm run build`                                                                                | 成功                                  | V-4：独立静态 dist，约5.9 MB，包含PDF worker、字体、样例，无原录音                                                           |
| `npm run test:deploy`                                                                          | 成功                                  | V-4：实际构建产物在 `/practice/` 子路径运行，网页、真实PDF导入、worker和资源均无404或页面异常                                |
| `npm run format:check`                                                                         | 通过                                  | 源码、脚本、测试、README、设计和计划格式                                                                                     |
| `npm install` / 依赖新增安装                                                                   | 审计为0 vulnerabilities               | 当前锁文件依赖，不能证明未来无漏洞                                                                                           |

测试先于导入和播放器实现建立，并观察到缺少对应模块的失败。复核中新增“完成后重播末词”用例，先观察到错误播放首词，修复后通过；系统无结束事件的等待失败也已覆盖。

## 排查与限制

错词复习中取消勾选会立即移除自身行；Playwright 的 `uncheck()` 等待已移除元素导致测试超时。页面截图已显示队列正确归零，测试改为实际点击并断言队列，未为了测试改变产品行为。

此 Linux 主机缺少 WebKit 的若干共享库，已下载并解包到临时测试目录，无需变更系统安装；原启动包装器覆盖 LD_LIBRARY_PATH，故测试使用临时启动程序加载同一 Playwright WebKit 二进制。其他环境使用标准 `npm run test:browser`，按 Playwright 文档准备自身系统依赖。

执行时观察到 `NO_COLOR` 与 `FORCE_COLOR` 冲突警告；会话环境变量的来源未核实。测试断言和构建没有因此失败。

自动语音在浏览器集成测试中使用可控模拟，验证选择和控制调用；PDF 导入使用真实文件、真实 PDF.js worker。桌面 WebKit 不是实体 iPad：具体英音音质、实际系统语音的连续播放、后台/锁屏行为仍需用户在 iPad Safari 试听和试用。页面已提供试听、声音刷新和播放失败提示，未声称真实 iPad 发音已验证。

扫描 PDF、任意复杂排版、离线、跨设备同步均不在本版承诺内。浏览器可能清理本地数据；导入切源的错词清空在确认界面明确提示。

Issues List 无 open issue，Blocks List 无 open block；可部署产物及验证范围已交付，真机体验作为试用项明确保留。
