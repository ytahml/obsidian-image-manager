# 命令与右键范围入口收束

## Context

- 当前分支 `ytahml/feature-3`，起点 `ed01cde`，规划前工作区干净；当前阶段只编写计划，不改代码。
- Wiki 转 Markdown 注册了三个命令：`convert-reference-format`、`convert-reference-format-vault`、`convert-to-md`。当前笔记的两个入口调用同一实现；右键笔记复用了带“兼容快捷入口”的文案，文件夹暂无线性对应的转换入口。
- 上传的 `upload-note-images` 与 `batch-upload` 已进入同一个 `BatchUploadDialog`：前者预选当前笔记，后者默认全库；笔记和文件夹右键也进入该弹窗。
- 目标：每类操作在命令面板只保留一个入口，默认全库；右键按目标笔记/文件夹确定范围；移除兼容性和重复范围等冗余描述。

## Approach

- 推荐命令名称统一为“Wiki 图片转 Markdown”和“上传笔记引用的图片”。单张图片上传保持独立，不改变其能力。
- 保留 `convert-reference-format` 作为统一转换命令，保留 `batch-upload` 作为统一范围上传命令；取消注册 `convert-reference-format-vault`、`convert-to-md`、`upload-note-images`。总命令数从 11 个变为 8 个；其余命令及门控不变，不保留隐藏别名，也不自动改用户快捷键。
- 上传复用现有弹窗与范围默认值，只收束重复命令和文案。笔记/文件夹右键继续打开上传弹窗并预选目标，允许调整范围；菜单使用同一简洁操作名称。
- 转换增加统一范围选择入口（全库、递归文件夹、笔记），命令调用默认全库；右键笔记或文件夹直接执行目标范围，不打开选择或确认弹窗。
- 已发现旧转换流程使用 `cachedRead()` 后无条件写回旧结果；新统一转换工作流复用现有 `readNoteSnapshot()` / `writeNoteSnapshot()`，读取实时 Editor，冲突时保留原文，逐篇失败不阻断其他笔记，汇总实际写入数、跳过及冲突/失败。转换不上传、不移动或删除附件。
- 用户已确认：取消重复命令注册，接受原快捷键需要重新绑定；右键转换直接执行被点击笔记/文件夹的范围，不弹窗。命令面板转换仍打开范围选择，默认全库，确认后执行。
- 本次经用户确认取消重复命令，是既有命令兼容约定的明确例外；更新文档中的命令表和数量，并在变更说明中提示重新绑定被移除命令的快捷键，而不在命令或菜单标题中添加兼容性说明。
- 将三种笔记范围类型及筛选抽取为小型共享工具；上传继续使用原有规划逻辑，只复用笔记选择。将现有目标选择器抽成可复用组件，转换采用独立轻量弹窗，不把上传配置弹窗扩张成多业务通用框架。
- 范围转换使用独立工作流，`main.ts` 只负责入口和 Notice。一次执行固定目标笔记集合，每篇读写前重验；无有效笔记不写入。转换期间拒绝再次启动转换，逐篇冲突/失败单独统计，不承诺跨文件原子事务。
- 仅转换选定 Markdown 笔记中的 Wiki 图片，保留普通 Wiki 链接、既有 Markdown、远程/缺失/歧义引用的既有处理规则；不受上传图床配置或粘贴格式设置限制。

## Files to modify

- `src/commands.ts`：收束转换与范围上传命令。
- `src/main.ts`：命令和右键接线、统一范围转换编排。
- `src/utils/note-scope.ts`（新增）、`src/uploaders/upload-scope.ts`：共享范围类型和笔记选择，保持上传范围 API/行为不变。
- `src/modals/note-target-picker.ts`（新增）、`src/modals/batch-upload-dialog.ts`：抽取并复用当前文件夹/笔记选择器。
- `src/modals/convert-reference-dialog.ts`（新增）：命令专用范围选择、目标选择和执行按钮；默认全库，取消/关闭不执行。
- `src/utils/scoped-reference-conversion.ts`（新增）：统一转换、安全读写、逐篇结果汇总；复用 `src/utils/note-content.ts`，原则上不修改其底层实现。
- `src/i18n/zh.ts`、`src/i18n/en.ts`：统一命令、菜单、范围与提示文案。
- `tests/commands.test.ts`、`tests/batch-upload-dialog.test.ts`、`tests/upload-scope.test.ts`：更新入口断言并防止上传回归。
- 新增共享范围、转换工作流、转换弹窗及菜单接线行为测试，使用现有 Obsidian mock 风格，不用源码字符串断言替代行为。
- `README.md`、`README_ZH.md`、`.agents/skills/obsidian-image-manager/SKILL.md` 及 architecture/local-image-workflows/hosting-and-remote/settings-and-ui/development references：同步入口、命令数量和范围行为。
- `docs/design/command-scopes.md`（新增）及设计索引：记录统一入口、右键直接转换与旧命令移除决策；更新与其冲突的现有范围上传契约措辞。

## Reuse

- `createImageCommands()` — `src/commands.ts`：集中命令定义。
- `batchUpload()`、`uploadNoteImages()` — `src/main.ts`：上传已经统一，后者只是传入笔记范围。
- `BatchUploadDialog` / `UploadTargetPicker` — `src/modals/batch-upload-dialog.ts`：已有三种范围和目标选择交互。
- `UploadScope` / `createUploadPlan()` — `src/uploaders/upload-scope.ts`：已有范围语义；转换不能复用上传图片收集作为转换前置条件。
- `RefConverter.convertAllReferences()`：保留 Wiki → Markdown 的解析、相对路径和歧义跳过规则。
- `readNoteSnapshot()` / `writeNoteSnapshot()` — `src/utils/note-content.ts`：已有 Editor 一致性、文件身份、内容快照和 Vault 比较写回保护，无需另写一套。

## Steps

- [x] 确认旧命令移除和右键转换交互决策。
- [x] 检查转换写回、现有选择器和测试，确定最小共享边界。
- [x] 计划批准后在当前任务分支继续实施；先更新入口契约，再抽取小型共享范围工具和目标选择器。
- [x] 实现安全范围转换工作流及命令专用弹窗，替换旧转换重复实现。
- [x] 收束命令与菜单文案，接入默认全库与右键目标范围；取消冗余上传包装方法（若无其他调用）。
- [x] 补充行为测试并更新 README、技能参考；不更改版本、不推送、不合并、不发布。
- [x] 完成自动验证后，单独记录真实 Obsidian 验收状态。

## Verification

- 断言准确的 8 个命令及移除的 3 个 ID；每类只出现一个范围入口，无“兼容快捷入口”等描述；无活动文件、活动图片或笔记时都能打开两个范围命令，且每次默认全库。
- 转换弹窗取消/关闭零写入；缺少有效目标禁用执行；执行防重复，键盘提交遵循 IME 规则；中英文均无缺失词条。
- 笔记/文件夹右键使用被点击的目标，而不是活动笔记；转换不打开弹窗，上传继续弹窗；文件夹范围递归且不误包含相邻前缀，覆盖根目录、空目录和失效目标。
- 上传保留去重、可选全库引用替换、本地图片保留及无重叠上传规则。
- 转换覆盖全库/文件夹/笔记、无 Wiki 引用、跳过项与实时编辑器内容，不改范围外笔记；覆盖多个 Editor 分歧、读写期间内容变化/重命名/删除、单篇读写失败继续后续笔记及统计不虚报成功。
- 实施后运行 `npm test`、`npm run build`、`git diff --check`；真实 Obsidian 菜单和快捷键验收单独记录，不以自动测试替代。
