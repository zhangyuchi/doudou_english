# 预置英音

内置 161 项均随网站提供音频。当前 4 项为 Wikimedia Commons / Lingua Libre 真人录音，157 项为 Piper `en_GB-cori-high` 本地生成；开放库下载过程中遇到 HTTP 429 限流，因此没有把已找到但未下载的文件算作交付。不是教材原录音，也不声称合成声音优于所有系统增强声音。

页面默认选择“预置英音”。现代 iPad Safari、Android、Windows、macOS 和 Linux 浏览器使用相同的 WAV 文件，不需要系统语音、TTS 账户或语音 API。首次播放需要点击，网站和音频资源需要能访问；不承诺所有旧系统、离线访问或锁屏继续播放。

音频驱动在点击中创建并解锁 AudioContext，异步加载同站资源、解码后播放。每遍结束才触发下一段等待；取消同时中止请求和失效旧回调。已解码的文件缓存最多 32 个。切后台自动暂停，返回后点击继续。试听不替换听写队列或设置，暂停期间禁用试听以保留倒计时。

导入项按小写、首尾去空白、内部空白合并、弯引号转直引号匹配。已经收录的英文可直接复用录音；未收录的整组禁止预置听写，单项复习仍可播放已收录项。维护者可补充资源，也可主动选择设备提供的系统 `en-GB` 声音；音频故障不会自动降级或跳词。

## 来源与许可

网站 [来源与许可](../public/audio/credits.html) 页面列出逐项署名。完整清单为 [manifest.json](../public/audio/manifest.json)，包含原始来源、下载地址、口音证据、作者、许可、原始与处理后 SHA256、长度、处理方法，以及合成工具、模型校验值、生成文本和日期。

真人录音由 Back ache 提供，采用 CC BY-SA 4.0；英国口音依据为同一说话者在 Wiktionary 中明确标为 London 的录音，相关链接记录在清单中。原录音转换为单声道 PCM WAV、统一音量并裁剪首尾静音；修改后的文件继续按同一许可提供。不得丢弃作者或许可页面。

合成使用 [Cori high 模型](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_GB/cori/high)。[模型卡](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/cori/high/MODEL_CARD) 和 [作者网站](https://brycebeattie.com/files/tts/) 将该英国英语模型及 LibriVox 语料标为 public domain；本项目生成片段以 CC0 提供。Piper 软件本身的 GPL 许可不等同于音频许可。模型和准备工具不包含在部署包中。

`tear` 按教材“眼泪”的读音 `/tɪə/` 显式设置音素，避免读成“撕裂”。不同说话者的音色及单词重音可能不同；资源结构、解码和信号检查不能代替人工听感验收。

## 维护资源

普通 `npm run dev` 和 `npm run build` 只使用已提交的资源，不下载录音或合成新词。

准备新文件时，先核对逐文件许可和口音，再在独立目录准备原始音频及 JSON 数组。每项包括 `english`、`rawFile`、目标 `file`、`kind`、`locale`、`sourceURL`、`author`、`license`、`licenseURL`、`accentEvidence`、`accentEvidenceURL`；合成项另有清单中的 `generation` 字段。只录制完整听写项，不拼接多个单词冒充短语。

合成缺失项可在维护者自行准备的 Python 环境安装 Piper，加载同一模型后执行：

```python
import wave
from piper import PiperVoice, SynthesisConfig

voice = PiperVoice.load('/path/to/en_GB-cori-high.onnx')
with wave.open('/path/to/raw/new-phrase.wav', 'wb') as wav:
    voice.synthesize_wav('new phrase.', wav,
                         syn_config=SynthesisConfig(length_scale=1.1))
```

保留生成参数、实际模型 SHA256 与许可信息。当前生成工具版本是 `piper-tts 1.4.2`；更换模型或版本需重新验收，不能只复制旧清单。维护工具使用项目已有的 Playwright Chromium 解码，输出兼容的 PCM WAV，不需要 FFmpeg：

```bash
node scripts/normalize-audio.mjs /path/to/prepared.json /path/to/raw
npm test
npm run test:browser -- --project=chromium-ipad
npm run build
npm run test:deploy
```

该工具重写 `public/audio/manifest.json`、`public/audio/credits.html`、`src/audio-catalog.json` 和对应 WAV，因此应传入完整目录，并只在资源更新时运行。新增声音的模型卡快照另行保存。真人录音遵守原许可，合成项目填写真实的模型及输出许可。
