# PR #54 审查问题修复计划

## Context

PR #54（提交 `7596ef8`）修复同名 Markdown 图片在整理后指向错误文件的问题。复核确认：主方向正确，但当前实现仍有 5 个可达的安全/一致性缺口；其中 3 项会继续移动、上传或改写错误目标，当前不应合并。

### 已确认问题

1. **P1：尖括号远程 Markdown 目标被当成本地文件**
   `ImageReorganizer` 在目标标准化前判断远程地址，`<https://…/image.png>` 随后会被解包并通过 basename 命中本地图片。
2. **P1：Vault-root 与来源相对路径同时命中时仍按顺序选取**
   metadata cache 无结果时，明确候选未整体去重/判歧义，可能错误选择 Vault-root 文件；`LocalReferenceIndex` 也可能只保护错误候选。
3. **P1：上传后的跨笔记替换仍按 basename 猜测**
   `UploadReferenceManager` 没有使用来源笔记感知解析器，可能把另一笔记实际指向同名其他图片的引用替换为本次上传 URL。
4. **P2：计划阶段生成的唯一目标路径可能在执行前失效**
   `ensureDirectory()` 等待期间出现同名文件时，rename 使用过期目标；部分文件可能已移动但引用尚未写回。
5. **P2：并发编辑会让已移动图片留下旧引用**
   `writeSnapshot()` 发现内容变化后静默保持原文，但文件已移动，结果仍可能报告成功且 `skipped=0`。

## Confirmed decisions

- PR #54 一次修复全部 5 项，不把 P2 留到后续。
- 并发快照在 mutation barrier 前失效时，整次单笔记或文件夹整理必须安全中止，图片移动数为 0；不能把“图片已移动但引用未更新”当作可接受降级。

## Approach

### 1. 统一解析边界

- 在 `resolveLocalFileReference()` 内完成 Markdown 尖括号解包、逐段容错解码和远程分类，返回一致的 `remote | resolved | missing | ambiguous`；整理、上传、转换和索引不再各自在原始字符串上先行判断。
- metadata cache 返回 eligible `TFile` 时仍为权威结果。否则收集并按路径去重所有明确候选（Vault-root 与来源目录相对路径）：0 个继续 fallback，1 个 resolved，多个 ambiguous。
- basename 仅在所有明确候选均未命中后使用，且仍须全 Vault 唯一；所有 ambiguous candidates 保持路径排序，供只读索引保守保护。

### 2. 上传替换按文件身份匹配

- `UploadReferenceManager.replaceVaultReferences()` 为当前 Vault 构建一次 lookup；逐篇笔记解析每个候选引用，仅当结果唯一且 `resolution.file.path === imageFile.path` 时替换。
- remote、missing、ambiguous 以及唯一解析到其他同名文件的引用全部保持原文；移除 `shouldReplaceLocalImageReference()` 的 basename 猜测职责及相应旧测试。
- 保留 `skipFile`、反向 offset 替换、模板渲染和替换计数语义；`ExplicitUploadWorkflow` 只在接口或统计需要时调整。

### 3. 将整理改为显式批次事务

- 让单笔记和文件夹命令共用内部 `ReorganizationPlan`：一次读取目标笔记、绑定图片身份、去重待移动文件，并预绑定 Vault 中所有受影响引用；文件夹命令不再逐笔记边计划边移动。
- 保留现有笔记遍历与反向引用顺序，确保同名冲突后缀确定性；同一图片被多篇目标笔记引用时只产生一个 move，并用测试固定最终目标选择规则。
- 先创建所需目录，再重新计算所有唯一目标路径并写入 `oldPath → finalPath`；紧接 mutation barrier 前重新读取每个参与笔记、校验完整快照/原引用位置，同时确认源文件仍在 originalPath。任何不一致都抛出可识别的并发冲突，且尚未执行 rename。
- rename 前再次检查当前 finalPath；若被占用则基于批次 reserved paths 重新分配后缀并更新 plan，随后才生成引用文本，避免使用过期路径。
- `writeSnapshot()` 返回明确的 applied/unchanged/conflict 状态，不能静默保留旧内容后继续成功。执行阶段记录已完成 rename 和已写入笔记；异常时按逆序回滚文件，并仅在笔记仍等于插件刚写入内容时回滚文本，避免覆盖新的用户编辑。回滚不完整时抛出明确的 partial-failure，而不是返回成功计数。
- 主流程把预执行并发冲突、执行失败和回滚不完整作为失败 Notice；成功结果只统计真实完成的移动/跳过。由于 Obsidian 不提供跨文件原子事务，契约明确区分“mutation barrier 前保证零移动”和“barrier 后异常的受保护回滚”。

## Files to modify

- `src/utils/local-image-resolution.ts`
- `src/utils/image-reorganizer.ts`
- `src/uploaders/upload-reference-manager.ts`
- `src/uploaders/explicit-upload-workflow.ts`（仅在接口/统计需要传播时）
- `src/utils/upload-reference.ts`（保留远程判断，移除 basename 替换谓词）
- `src/main.ts`（整理冲突/partial failure 的用户可见结果）
- `src/i18n/en.ts`
- `src/i18n/zh.ts`
- `tests/local-image-resolution.test.ts`
- `tests/local-reference-index.test.ts`
- `tests/image-reorganizer.test.ts`
- `tests/upload-reference-manager.test.ts`
- `tests/upload-reference.test.ts`
- `tests/explicit-upload-workflow.test.ts`（若结果接口变化）
- `.agents/skills/obsidian-image-manager/references/local-image-workflows.md`

## Reuse

- `createLocalFileLookup()` / `resolveLocalFileReference()`：`src/utils/local-image-resolution.ts`
- `isRemoteImageReference()`：`src/utils/upload-reference.ts`
- `RefConverter.parseReferences()` 与反向 offset 替换模式：`src/utils/ref-converter.ts`
- `ImageReorganizer.ensureUniquePath()`、`buildReference()`、`writeSnapshot()`：保留职责并改为批次计划/显式结果，`src/utils/image-reorganizer.ts`
- `BatchRename` 的“引用与 rename 顺序必须显式控制”经验：`src/utils/batch-rename.ts`；它没有可直接复用的跨文件回滚实现，因此不复制其 basename 匹配逻辑。
- 现有 Vault mock、文件身份和调用顺序断言：`tests/image-reorganizer.test.ts`、`tests/local-image-resolution.test.ts`、`tests/upload-reference-manager.test.ts`

## Steps

- [x] 先为 5 项问题增加失败测试，证明当前 HEAD 可复现，并保留测试作为回归门禁。
- [x] 扩展共享解析结果与候选归并，统一 remote、明确路径冲突、唯一 basename 和 candidate 排序语义；同步本地引用索引测试。
- [x] 将上传后的 Vault-wide 替换迁移到来源笔记解析 + `TFile.path` 身份匹配，移除 basename 猜测。
- [x] 引入单笔记/文件夹共用的 `ReorganizationPlan`，集中完成目标笔记快照、图片去重、跨笔记引用绑定和 deterministic move 计划。
- [x] 加入目录准备、执行前 finalPath 重算、全参与笔记 mutation barrier；冲突时抛出并保证零 rename。
- [x] 加入执行 journal、显式写回结果与受保护回滚；修正 moved/skipped/失败传播及中英文 Notice。
- [x] 更新本地工作流契约，记录共享解析、批次事务、零移动 barrier 和 barrier 后回滚边界。
- [x] 运行聚焦测试、完整测试、build、diff check，并完成真实 Obsidian 验收。

## Verification

### Automated

- `npm test -- tests/local-image-resolution.test.ts tests/local-reference-index.test.ts tests/image-reorganizer.test.ts tests/upload-reference-manager.test.ts tests/upload-reference.test.ts tests/explicit-upload-workflow.test.ts`
- `npm test`
- `npm run build`
- `git diff --check`

新增测试矩阵至少覆盖：

- `<https://…>`、`<//…>`、data/blob 目标解析为 remote，整理中不触碰同 basename 本地文件。
- metadata cache 无结果且 Vault-root/来源相对路径同时存在时返回 ambiguous；`LocalReferenceIndex` 将两个候选都加入 indeterminate。
- 当前笔记明确上传 `one/photo.png`，其他笔记短引用实际解析到 `two/photo.png`、歧义或 missing 时均不替换；明确解析到 `one/photo.png` 时仍替换。
- 目录创建期间目标路径被占用时重新生成后缀，并使用执行时真实 finalPath 更新当前和其他笔记。
- 单笔记及文件夹批次中，任一参与笔记在 mutation barrier 前变化时零 rename、零覆盖，并产生可见并发失败。
- 多笔记共享同一图片时只移动一次，最终目标与既定遍历规则一致；同名多图片后缀分配保持确定。
- 第二个 rename 或某次 note write 失败时执行受保护回滚；若模拟回滚本身失败，结果必须为 partial failure，不能报告普通成功。
- 已存在的同名、Unicode、Wiki 跳过、跨笔记更新、转换统计和文件夹递归用例继续通过。

### Real Obsidian acceptance

- 在专用 Vault 中复验 Issue #53 的 A/B 同名图片整理。
- 手动验证尖括号远程引用不触碰本地文件。
- 在整理确认后、实际移动前修改另一篇引用笔记，确认命令安全中止且没有图片被移动。
- 模拟目标目录出现同名文件，确认使用新后缀且所有引用指向实际目标。
- 上传一张同名图片后确认其他笔记的明确、歧义和不同目标引用均保持正确。
