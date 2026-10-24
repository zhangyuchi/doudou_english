# 通过命令行导入单词文件

网页导入已停用。维护者在电脑使用命令导入 TXT、CSV 或文字版中英 PDF，生成完整音频后发布词表。网页刷新后读取已发布词表；历史浏览器词表与错词仍能恢复。

## 预览、生成与发布

先在本机 `.env.local` 配置阿里云凭证，详见[阿里云英音接入](aliyun-audio.md)。当前使用 Luna 精品英音时，显式指定音色，避免新词表使用默认 Emily：

```bash
npm run import:aliyun -- --quality premium --voice Luna_v3.1 --input words.csv
npm run import:aliyun -- --quality premium --voice Luna_v3.1 --input words.csv --execute
npm run deploy
```

第一条仅预览词数、组数与待生成数量，不调用 API。第二条下载缺失音频，全部完整后发布词表并构建本地网站；第三条更新已配置的远端网站。标准版省略 `--quality premium` 和精品 `--voice` 参数。

命令不读取浏览器 localStorage。要将历史浏览器词表发布到网站，需通过 `--input` 指定同一原始文件。更换已发布词表会替换网页当前词表并清空旧词表的错词；同一词表补音频或切换品质保留错词。

## PDF：支持的排版

支持具有文字层的中英词表，尤其是附带的[外研社七年级词表](../public/examples/外研社7年级英语听写分组.pdf)，共 11 组、161 项；完整短语算一项。

- 文件应能选中或复制文字；扫描照片和图片 PDF 需先做 OCR，命令没有内置 OCR。
- 解析通过英文、中文位置与留白恢复分组；多栏、表格或特殊排版可能识别不准，必要时整理为 TXT/CSV。
- 只有英文的 PDF 不属于当前解析目标，可将英文整理成 TXT/CSV。
- 只有编号和录音入口的 PDF 没有词表，不适合作为单词源，也不会提取 PDF 内的音频。

付费执行前核对原文件中的词项、释义和分组。文件解析成功不保证任意排版都识别准确。

## TXT：一行一个词或短语

使用 UTF-8 纯文本。英文与可选中文之间用实际 Tab，空行分组；只有英文也可以。参考 [words.txt](../public/examples/words.txt)：

```text
hello	你好
primary school	小学

point out	指出
```

短语不会按空格拆词。不要把 Tab 写成反斜杠加字母 t。

## CSV：电子表格导出

列顺序为英文、中文、可选组号，支持 `english,chinese,group` 表头。中文可为空；含逗号时使用双引号。参考 [words.csv](../public/examples/words.csv)：

```csv
english,chinese,group
hello,你好,1
primary school,小学,1
point out,"指出,指明",2
```

相同组号合并，按组号首次出现的顺序排列；显示名称为第 1 组、第 2 组等。使用 UTF-8 CSV，不接受 `.xlsx` 或 `.numbers` 文件。

## 分组、范围与保存

- 单组超过 15 项时按 15 项拆分；其他分组边界保留。
- 每份文件最多 20 MB、2000 项，PDF 最多 100 页。
- 英文支持单词、空格连接的短语、撇号、连字符和点号，不接受数字等其他符号；每项英文最长 100 字符，中文最长 500 字符。
- 执行时向阿里云发送英文词项。生成的音频和清单保存在维护电脑，远端部署不上传 API Key。
- 网页设置和错词保存在当前网站地址下的浏览器 localStorage，不跨设备同步；清理网站数据会丢失记录。
- 发布失败时已完成音频保留，重跑复用有效文件。具体恢复方式见[阿里云音频说明](aliyun-audio.md)。

部署、版本查询与回滚见[部署指南](deployment.md)。回滚服务器文件不会回滚浏览器词表和错词。
