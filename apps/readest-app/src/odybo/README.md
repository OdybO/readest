# odybo：语境查词（我们自己的改动）

我们加的功能都放在这个文件夹里。Readest 原来的代码只改了下面几处，每处都带 `[odybo]` 注释，合并上游时只要看这几处：

| 文件 | 改了什么 |
|---|---|
| `src/services/dictionaries/registry.ts` | 「语境词典」（`builtin:context`）返回 `odyboContextProvider` |
| `src/services/dictionaries/contextDictionary.ts` | `buildSelectionContext` 开头调用 `rememberSelection(range)`，另外记一份整段上下文 |
| `src/app/reader/components/annotator/DictionaryResultsView.tsx` | 我们的卡片查询中也显示（边出边显示）、不折叠成 4 行：`isOdyboStreamingProvider(p.id)` |
| `apps/readest-app/.env.local`（不进 git，云编译时生成） | `NEXT_PUBLIC_SELF_HOSTED=true`，付费功能的开关全部打开 |
| `src-tauri/gen/android/app/build.gradle.kts` | `applicationId = "com.odybo.readest"`，和官方版能同时装 |
| `src/components/settings/SettingsDialog.tsx` | 设置窗口加一个「语境查词」标签（类型里加 `'Odybo'`、标签列表加一项、渲染 `OdyboSettingsPanel`、重置表加一项） |
| `src/services/commandRegistry.ts` | 设置标签的图标表加 `Odybo`（类型要求每个标签都有图标） |
| `.github/workflows/odybo-android.yml`（新文件） | 只编译 64 位 ARM 安卓版，手动触发；要仓库 Secrets：`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`、`ANDROID_KEY_BASE64` |

## 文件

- `context-paragraph.js`：整段上下文算法。PDF 按文字层的位置重建行、栏、段落；EPUB 取所在块加前后块；总长不超过 2000 字。回归测试在 `D:\Tools\CtxLookup\整段上下文\unit.mjs`。
- `selection.ts`：选中文字时记下整段上下文，查词时按选中的文字取回。
- `prompt.ts`：提示词，从电脑小工具 `D:\Tools\CtxLookup\ctx_lookup.py` 的 `SYSTEM` 原样抽出来。
- `provider.ts`：顶替「语境词典」，用我们的提示词，答案边出边显示，同一个词同一段上下文查过就直接显示。
- `history.ts`：查过的答案存进本机 IndexedDB（库名 `odybo-ctx-lookup`），关掉 App 也在。同一本书 + 同一个选中的内容 + 同一句算查过，直接显示并标「本机记录」。
- `prefetch.ts`：句子预读，照小工具的 rolling_prefetch：卡片底部勾「本书自动预读」（每本书单独记，默认关）后，每次查完就从选中处往后预读 3 截（20 词以内整句一截，长句切成 8～20 词的几截，长句整句另外一份），同时最多 3 个请求，存进本机。选中的正好是预读过的一截或一句、或是某一截的一半以上，直接显示并标「预读」。不预读单个的词。
- `settings.ts` / `SettingsPanel.tsx`：我们自己的设置页（设置窗口最后一个标签「语境查词」），存在本机 localStorage：往后预读几截、同时几个请求、所有书都自动预读；显示本机记录条数。以后生词本的设置也放这里。
- `render.ts`：排版，照小工具：栏目名粉色、【这里的意思】大字、【整句翻译】浅蓝、词组等英文黄色；内容是「无」的栏目和【原形】不显示；最后附原句，选中的粉色加粗、词组短语加下划线。

## 怎么用

1. 设置 → Language → Custom Translators → Add Translator：选 OpenAI Compatible，填 N1 的地址、密钥、模型（`gemini-3.8-flash-high(low)`）。
2. 设置 → Language → Manage Dictionaries：打开 Context Dictionary（显示名是「语境查词」），拖到最上面。
3. 选中文字 → Dictionary。
