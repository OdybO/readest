# odybo：语境查词（我们自己的改动）

我们加的功能都放在这个文件夹里。Readest 原来的代码只改了下面几处，每处都带 `[odybo]` 注释，合并上游时只要看这几处：

| 文件 | 改了什么 |
|---|---|
| `src/services/dictionaries/registry.ts` | 「语境词典」（`builtin:context`）返回 `odyboContextProvider` |
| `src/services/dictionaries/contextDictionary.ts` | `buildSelectionContext` 开头调用 `rememberSelection(range)`，另外记一份整段上下文 |
| `apps/readest-app/.env.local`（不进 git，云编译时生成） | `NEXT_PUBLIC_SELF_HOSTED=true`，付费功能的开关全部打开 |

## 文件

- `context-paragraph.js`：整段上下文算法。PDF 按文字层的位置重建行、栏、段落；EPUB 取所在块加前后块；总长不超过 2000 字。回归测试在 `D:\Tools\CtxLookup\整段上下文\unit.mjs`。
- `selection.ts`：选中文字时记下整段上下文，查词时按选中的文字取回。
- `prompt.ts`：提示词，从电脑小工具 `D:\Tools\CtxLookup\ctx_lookup.py` 的 `SYSTEM` 原样抽出来。
- `provider.ts`：顶替「语境词典」，用我们的提示词，答案边出边显示，同一个词同一段上下文查过就直接显示。

## 怎么用

1. 设置 → Language → Custom Translators → Add Translator：选 OpenAI Compatible，填 N1 的地址、密钥、模型（`gemini-3.8-flash-high(low)`）。
2. 设置 → Language → Manage Dictionaries：打开 Context Dictionary（显示名是「语境查词」），拖到最上面。
3. 选中文字 → Dictionary。
