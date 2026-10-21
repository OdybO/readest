# odybo：语境查词（我们自己的改动）

我们加的功能都放在这个文件夹里。Readest 原来的代码只改了下面几处，每处都带 `[odybo]` 注释，合并上游时只要看这几处：

| 文件 | 改了什么 |
|---|---|
| `src/services/dictionaries/registry.ts` | 「语境词典」（`builtin:context`）返回 `odyboContextProvider` |
| `src/services/dictionaries/contextDictionary.ts` | `buildSelectionContext` 开头调用 `rememberSelection(range)`，另外记一份整段上下文 |
| `src/app/reader/components/annotator/DictionaryResultsView.tsx` | 我们的卡片查询中也显示（边出边显示）、不折叠成 4 行：`isOdyboStreamingProvider(p.id)` |
| `apps/readest-app/.env.local`（不进 git，云编译时生成） | `NEXT_PUBLIC_SELF_HOSTED=true`，付费功能的开关全部打开 |
| `src-tauri/gen/android/app/build.gradle.kts` | `applicationId = "com.odybo.readest"`，和官方版能同时装 |
| `src/app/reader/components/annotator/Annotator.tsx` | 单词透镜点小字查词那条路（`handleWordLensDictionary`）：①调用 `markWordLensLookup(element, 是不是单击查词)`：点透镜小字查的记成 `lens`（只记来源，10-21 起也进生词本）；②除了 `element` 也收 `range`（单击查词直接给选区） |
| `src/app/reader/utils/iframeEventHandlers.ts` | ①单击处理里，透镜判断后面调用 `odyboTapWord(event)`：开着「单击查词」、点在英文单词上，就发 `wordlens-dictionary`（带 `range`）去查；点空白处、链接、脚注照旧；②`handleTouchEv` 开头调用 `odyboTwoFingerTap`：开着「单击查词」时两指轻点呼出 / 收起工具栏 |
| `src/app/reader/components/FoliateViewer.tsx` | 章节一载入、透镜每次刷新完，调用 `markVocabInDoc(doc, 书名)` 在书里标出预读过的生词 |
| `src/app/reader/components/footerbar/NavigationBar.tsx`、`DesktopFooterBar.tsx` | 底部工具栏各加一个 `<OdyboToolbarButton>`（手机 / 平板一套，电脑一套） |
| `src/components/settings/SettingsDialog.tsx` | 设置窗口加一个「语境查词」标签（类型里加 `'Odybo'`、标签列表加一项、渲染 `OdyboSettingsPanel`、重置表加一项） |
| `src/services/commandRegistry.ts` | 设置标签的图标表加 `Odybo`（类型要求每个标签都有图标） |
| `.github/workflows/odybo-android.yml`（新文件） | 只编译 64 位 ARM 安卓版，手动触发；要仓库 Secrets：`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`、`ANDROID_KEY_BASE64` |

## 文件

- `context-paragraph.js`：整段上下文算法。PDF 按文字层的位置重建行、栏、段落；EPUB 取所在块加前后块；总长不超过 2000 字。回归测试在 `D:\Tools\CtxLookup\整段上下文\unit.mjs`。
- `selection.ts`：选中文字时记下整段上下文，查词时按选中的文字取回。
- `prompt.ts`：提示词，从电脑小工具 `D:\Tools\CtxLookup\ctx_lookup.py` 的 `SYSTEM` 原样抽出来。另有我们写的 `CHUNK_RULE` / `buildChunkPrompt` / `isChunkOf`：选中的是长句里的一截（超过六个词、整句比它长）时，把「所在句子」一起发过去，附上 `CHUNK_RULE`（开发者 10-21 定的「问法 E」）：整句只用来帮 AI 理解，翻译和拆解只管选中的词；开头或结尾切断了词组时，在翻译下面另起一行写「补充：……」。小工具原来的写法（「请结合整句理解，只翻译这一截」）真 AI 实测会把没选中的部分也翻进去，所以改了。预读长句的一截也用它。卡片上「补充」那行小一号、浅色（`render.ts`）。
- `provider.ts`：顶替「语境词典」，用我们的提示词，答案边出边显示，同一个词同一段上下文查过就直接显示。
- `history.ts`：查过的答案存进本机 IndexedDB（库名 `odybo-ctx-lookup`），关掉 App 也在。同一本书 + 同一个选中的内容 + 同一句算查过，直接显示并标「本机记录」。
- `prefetch.ts`：句子预读，照小工具的 rolling_prefetch：卡片底部勾「本书自动预读」（每本书单独记，默认关）后，每次查完就从选中处往后预读 3 截（20 词以内整句一截，长句切成 8～20 词的几截，长句整句另外一份），同时最多 3 个请求，存进本机。选中的正好是预读过的一截或一句、或是某一截的一半以上，直接显示并标「预读」。不预读单个的词。
- `settings.ts` / `SettingsPanel.tsx`：我们自己的设置页（设置窗口最后一个标签「语境查词」），存在本机 localStorage：预读截数（默认 3）、短句长度（默认 20 个词）、所有书自动预读（默认关）、恢复默认；说明收在名字右边的 ⓘ 里点开看。预读同时查询数固定 3、不放进设置页。以后生词本的设置也放这里。
- `vocab.ts` / `VocabPage.tsx`：生词本（设置 → 语境查词 → 生词本 >），照小工具 vocab_list，从「自己查过的」记录算出来：只收 6 个词以内的单词和短语（整句不收），按【原形】跨书合并；分「一周内 / 一个月内 / 更早」三栏（按最近一次查询）；每行原形、次数、最近一次的意思、最近查询时间（月-日 时:分），点开看各种写法和每一次的书、时间、原句（查的词粉色加粗）；删除要点两次，删掉后再查一次会回来（再查同一处会刷新查询时间）。
- 生词预读（在 `prefetch.ts`）：句子预读时，预读的那几截里出现了生词本前 N 个（默认 20）、最近 D 天（默认 30）查过的词，就另外预读「这个词在这一句里」，每次最多 M 个（默认 5，0 = 不预读生词），每个词单独一次请求、格式和自己点查一样；句子的请求里也提醒 AI 一定解释这些生词（照小工具 vocab_hint）。点到这个词时直接显示，标「预读（生词）」。预读的答案被用上时也记进「自己查过的」。
- 查词卡片底下（单词和短语）：「移出生词本」（再查会回来）、「忽略」（再查也不进生词本，生词本「已忽略」栏可恢复）；点透镜小字查的也直接进生词本（开发者 10-21：划词、点透镜都说明不认识），没有「加入生词本」按钮；最右边「生词本」直接打开生词本（`vocabLink.ts` 的 `openVocabBook`；`provider.ts` 会被打进服务端代码，不能直接引用 `SettingsPanel.tsx` 这类界面代码，否则安卓正式打包报错，网页开发版查不出来）。
- `marks.ts`：在书里标出生词：预读过的（同一本书、同一个词、同一句）和自己查过的单词、短语（点透镜查的也算；忽略了的、移出生词本的不标），照透镜的做法包成 `<ruby class="wl-gloss odybo-vocab">`，字上面显示这一句里的解释（【这里的意思】第一个分句，10 个字以内整个留，更长在 10 字内最后一个「、」处截）或一个粉色的点；同一个词透镜也标了就换成我们的。点一下走透镜那条路直接查。只用于 EPUB 这类能重排的书。查词卡片开着、或者正选着文字时不动书里的标注（包词会改动选中的那段文字，Readest 当成选区没了会把卡片关掉——10-21 开发者遇到的「卡片自己关」），等卡片关了、选区取消了再标（每 0.8 秒看一次）。重标时只改要变的（开发者 10-21：整章拆掉重标文字会跳一下）：算出这一章应该有哪些标注，和已有的按「在整章文字里的位置」比，一样的不动，只是字不同的原地改字（换标法时），不该有的拆掉，新的才包上。查词时取上下文会去掉这些标注小字。
- `ToolbarButton.tsx`：底部工具栏的「语境查词」按钮，点开五个开关：显示透镜、生词预读（关掉 = 不预读生词、书里也不标）、生词标法（解释 / 点）、单击查词（默认关；开着时两指轻点呼出菜单）、本书自动预读。
- `tapLookup.ts`：单击查词。开着时，轻点正文里的一个英文单词（按手指位置找到字，再向两边扩到整个词，并确认真的点在这个词上）就查它，算自己查的；点空白处、页边照旧翻页、呼出菜单；只查单个词，短语和句子还是长按拖选；PDF 这类固定排版的书不做。查词卡片开着、或者选着文字时，轻点只是关掉它们，不查词（开发者 10-21）。
- `remotePrompts.ts`：提示词放在 WebDAV 上，改了不用重新编译。位置是 Readest 设置里 WebDAV「根目录」下的 `odybo/prompts/`（N1 上是 `X:\Private\ReadestSync\odybo\prompts\`，里面有 `说明.txt`）：`system.txt` 主提示词、`chunk.txt` 长句一截的要求、`vocab_hint.txt` 预读时的生词提醒（`{words}` 换成生词）。用 Readest 自己的 WebDAV 地址、账号和读文件函数；查词时在后台读，最多 10 分钟一次，读到的记在 localStorage `odybo.prompts`，连不上用上次的；某个文件没有就用 `prompt.ts` 里自带的；Readest 里没设 WebDAV 就全用自带的。设置页「提示词」一块显示现在用哪份，可以点「重新读取」。电脑小工具 `ctx_lookup.py` 读同一个文件夹（设置项 `prompt_dir`）。改了这些文件也要先用真 AI 跑（见下面「用真 AI 测」）。
- `dataSync.ts` / `changes.ts`：我们的数据同步备份到 WebDAV（10-21）。放在 WebDAV 根目录下 `odybo/data/<设备>/`（设备名 `android-xxxxxx` / `web-xxxxxx`，第一次用时随机生成，存在 localStorage `odybo.deviceId`）：`state.json`（移出 / 忽略的词带时间、我们的设置带时间）、`history-YYYY-MM.json`（这个月的查词记录）、`prefetch-YYYY-MM.json`（这个月的预读结果，设置里可以关）。每台设备只写自己的文件夹、读所有别人的；同一条（同一本书、同一个内容、同一句）按时间新的为准；移出 / 忽略也按时间，取消时记下取消的时间（`vocab.ts` 的 `odybo.vocabCleared`），所以「这台取消、那台以前设上」不会被翻回去；设置整份按改的时间。重装后设备名变了，旧文件夹当成别的设备读回来，就恢复了。什么时候：打开书、查词时最多 10 分钟拉一次；本机数据改了（`changes.ts` 通知），1 分钟后上传改过的月份；从 WebDAV 拉下来写进本机的不通知，不会又传回去；第一次同步把本机全部数据传一遍。别的设备的文件按「修改时间 + 大小」记着，没变就不再下载。设置页「同步到 WebDAV」：两个开关、上次同步结果、这台设备名、「立即同步」。网页版测试用本机假 WebDAV `测试脚本\fake_webdav.py`（127.0.0.1:8748，允许跨域）。
- `bookIntro.ts` / `BookIntroDialog.tsx`：「这本书的介绍」（读书之前了解这本书，10-21）。底部工具栏「语境查词」面板最上面的按钮打开。发给 AI 的只有书本信息：书名、作者、出版社、出版时间、分类、简介（前 800 字）、目录的章节标题（最多 40 条），不发正文；提示词 `prompt.ts` 的 `BOOK_INTRO_PROMPT`（WebDAV 上 `odybo/prompts/book_intro.txt` 有就用那份），回答八栏：一句话、作者、背景、讲什么、读了能得到什么、适合谁、英文难度、怎么读；不认识的书只写简介、目录里看得出来的，不照书名编。结果存在预读记录里（`kind: 'intro'`），跟着预读结果同步；再打开直接显示「本机记录」，可以「重新生成」。提示词用 N1 真 AI 测过 9 本书各两轮：`测试脚本\book_intro_test.py`（提示词原文 `book_intro_prompt.txt`，要和 `BOOK_INTRO_PROMPT` 一字不差）。
- `vocabLink.ts`：卡片上「生词本」按钮打开设置窗口、直接到生词本页。
- `twoFinger.ts`：开着「单击查词」时，两指轻点（两个手指放下、几乎不动、400 毫秒内抬起）呼出 / 收起工具栏，代替点屏幕中间；捏合缩放手指会动，不算。网页版只能用代码模拟触摸来测，真手感要在平板上试。

跳到别的章节后怎么回来：这是 Readest 自带的。点书里的链接跳走后，底部工具栏的进度面板（手机 / 平板点「Reading Progress」，电脑底栏直接有）里有「Go Back」箭头，回到跳之前的位置；脚注是弹窗显示，不跳走。
- `render.ts`：排版，照小工具（AI 偶尔在格式前面先自言自语一段，开头那行只从第一个「英 /」「美 /」开始显示，没有音标就整段不显示）：栏目名粉色、【这里的意思】大字、【整句翻译】浅蓝、词组等英文黄色；内容是「无」的栏目和【原形】不显示；最后附原句，选中的粉色加粗、词组短语加下划线。

## 怎么用

1. 设置 → Language → Custom Translators → Add Translator：选 OpenAI Compatible，填 N1 的地址、密钥、模型（`gemini-3.8-flash-high(low)`）。
2. 设置 → Language → Manage Dictionaries：打开 Context Dictionary（显示名是「语境查词」），拖到最上面。
3. 选中文字 → Dictionary。

## 开发、测试、编译（接手时照这里做）

### 仓库和分支

- 本机仓库 `D:\Project\Git Project\readest`，分支 `odybo`。远端 `fork` = 我们的 `OdybO/readest`（推这里），`origin` = 官方 `readest/readest`（只拉更新）。
- 仓库设了不转换换行符（`git config core.autocrlf false`），否则格式检查全报错。
- 规矩：我们的代码都放 `src/odybo/`；Readest 原来的代码只加最少的接入点，每处带 `[odybo]` 注释，并记进上面的改动点表。合并上游更新时只看这几处。
- 推送用 `git push --no-verify fork odybo`：推送前的检查会跑全套测试，本机缺云端才有的环境变量，词典相关测试原版也照样失败。所以推之前自己跑类型检查（见下）。只限这个仓库的 `odybo` 分支。
- pnpm 不在系统 PATH 里，在 `D:\Tools\pnpm`；跑命令前先 `export PATH="/d/Tools/pnpm:$PATH"`（Git Bash）。

### 类型检查

在 `apps/readest-app` 下：`NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/tsc --noEmit`，没输出就是通过（不加内存参数会内存不够）。整段上下文算法另有回归测试：`node D:\Tools\CtxLookup\整段上下文\unit.mjs`，最后一行「全部通过」。

### 网页版测试（大多数改动先在这里测，不用编译）

1. 开网页开发服务：运行 `D:\Tools\pnpm\readest_web.cmd`，打开 `http://localhost:3300`。改代码后会自动刷新。
2. 开探针（假 AI，不连外网、不用密钥）：`python -I D:\Tools\CtxLookup\测试脚本\ai_probe.py`，监听 `127.0.0.1:8747`。每个请求完整记进同目录的 `ai_probe.log`（看发出去的提示词、上下文对不对），回一段固定的按我们格式写的答案（【这里的意思】是「探针」，【原形】按选中的词猜）。它还把测试脚本目录里的文件放在 `http://127.0.0.1:8747/files/<文件名>`。
3. 网页版设置里加一个自定义翻译器（OpenAI Compatible）指向探针地址，词典里打开「语境查词」拖到最上面（同「怎么用」）。
4. 测试书 `D:\Tools\CtxLookup\测试脚本\vocab-test.epub`（书名 Word Form Test 2）：第一章 Vocab Prefetch Test 按步骤写了查哪些词测生词预读，第二章是各种词形（来自 `lemma_test.py epub` 生成的 `词形测试.epub`）。导入：在书库页用浏览器控制台从探针取文件，模拟拖进书库：
   ```js
   const blob = await (await fetch('http://127.0.0.1:8747/files/vocab-test.epub')).blob();
   const dt = new DataTransfer(); dt.items.add(new File([blob], 'vocab-test.epub', { type: 'application/epub+zip' }));
   for (const t of ['dragenter', 'dragover', 'drop']) document.body.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
   ```
   PDF 也能这样导入（暂时不测 PDF：能选中文字的 PDF 不如转成 EPUB 再读）。
5. 已知网页版的限制：
   - 要**从书库点开书**。直接刷新阅读页时 Readest 的章节载入事件有时收不到，透镜和我们的标注都不出来。
   - Readest 自带的单词透镜在网页版用不了（它的词表从 cdn.readest.com 下载，只允许 readest.com 的网页取）。测「点透镜小字」可以在控制台手工把一个词包成 `<ruby class="wl-gloss">词<rt>提示</rt></ruby>` 再点它。
   - 网页开发版不检查「服务端打包」的限制，安卓正式打包会：`provider.ts` 这类会被打进服务端的代码不能直接引用 React 界面代码（`.tsx` 组件、状态库），要用的话用 `import()` 用到时再加载（例：`vocabLink.ts`）。
   - 在控制台里：`window.__odyboDocs` 是打开着的章节文档 → 书名，可以用它查书里的标注（`ruby.odybo-vocab`）。本机记录在 IndexedDB `odybo-ctx-lookup`（`history` 自己查的、`prefetch` 预读的），设置在 localStorage `odybo.*`。

### 用真 AI 测（改了发给 AI 的内容必须做）

探针只回固定的假答案，只能确认「发出去的内容对不对」，看不出 AI 回答得好不好。改了提示词、提问的拼法（`prompt.ts`、`prefetch.ts` 里的 `userPrompt`），或者改了从回答里取东西的地方（`marks.ts` 的标注字、`vocab.ts` 的【原形】），**交给开发者测之前，自己先用 N1 真 AI 跑一遍**（开发者 10-21：「你自己都不知道有没有问题，让我测试」）。

- `D:\Tools\CtxLookup\测试脚本\real_ai_check.py`：照 Readest 代码里的写法拼请求发给 N1（密钥从 `config.json` 读，不打印）。分组：`cut` 选中长句的一截（含切断了词组的情况）、`hint` 预读整句带生词提醒、`label` 书里标注的字。改了 Readest 里的写法，这个脚本要跟着改。
- `chunk_test.py`（长句一截几种问法对比）、`lemma_test.py`（【原形】对不对）、`readest_prompt_test.py`（各种选法）也是真 AI。

### 编译安卓版

- 只编 64 位 ARM，在 GitHub 上编（`.github/workflows/odybo-android.yml`，手动触发，约 15 分钟）。gh 命令行在 `D:\Tools\gh\bin\gh.exe`（账号 OdybO）：
  - 触发：`gh workflow run odybo-android.yml -R OdybO/readest --ref odybo`
  - 等：`gh run watch <编号> -R OdybO/readest --exit-status`；失败看 `gh run view <编号> -R OdybO/readest --log-failed`
  - 下载：`gh run download <编号> -R OdybO/readest -D D:\Tools\readest-apk\<提交号>`，得到 `app-universal-release.apk`
- 签名：仓库 Secrets `ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`、`ANDROID_KEY_BASE64`，原件是 `D:\Tools\anx-keystore\anx.jks`。别换钥匙，换了平板上要卸载重装、记录全丢。
- 拷到平板（联想 Y700，电脑上显示 LAVIE Tab 9QHD1）：`powershell -File D:\Tools\CtxLookup\测试脚本\copy_to_tablet.ps1 -File <apk> -NewName readest-odybo-<提交号>.apk`，放到 SD 卡的 Download 目录。平板上直接覆盖安装，设置和记录都在。
- 包名 `com.odybo.readest`，和官方版能同时装。

### 进度和讨论记录

每一步做了什么、开发者定了什么、还剩什么，记在 `D:\Tools\CtxLookup\待办.md`「以后」一节、安卓阅读器（Anx → Readest）那一条下面，按日期往下接；新功能先在那里记方案。
