# Issue #45 图片浏览器批量选择实现计划

> 归档状态：该计划已由 [PR #46](https://github.com/ytahml/obsidian-image-manager/pull/46) 实现，并随 [v2.0.2](https://github.com/ytahml/obsidian-image-manager/releases/tag/2.0.2) 发布。当前行为以代码、canonical skill references 和现行设计契约为准。

## Context

Issue #45 已确认希望在图片浏览器中增加：

- 一键批量选择/取消选择；
- 按住 Shift 选择一段图片，行为接近 Windows 文件选择。

当前本地与远程图片浏览器都已经有逐项复选框和选择状态，但选择仅服务于安全删除：本地只允许选择明确孤立图片，远程只允许选择当前 fresh 索引和扫描快照中确认未引用的对象。后续产品决策已移除远程选择数量上限，但不得绕过逐对象资格验证、精确数量确认、两请求并发和无自动重试边界。

## Approach

推荐在本地和远程图片页使用一致的选择语义：

1. 在现有删除工具栏增加批量选择和清空选择入口。
2. 基于当前搜索、筛选、排序后的完整数据顺序计算批量选择和 Shift 区间，而不是依赖已经渲染的 DOM 卡片。
3. 普通复选框操作记录稳定 ID 作为 Shift 锚点；Shift 操作只影响锚点到目标之间的可选项目，区间外已有选择保持不变。
4. 搜索、筛选、排序或数据会话变化时清除锚点；既有合法选择继续按当前产品约定保留。
5. 远程批量操作继续经过 `RemoteDeleteSession` 和删除资格判断，选择数量不设上限。
6. 抽取纯选择函数覆盖本地/远程共同的区间计算和可测试语义，Modal 只负责投影数据和刷新 UI。

已确认的产品范围：

- 同时覆盖本地图片页和图床图片页；
- Shift 仅与复选框配合，普通点击卡片继续打开预览；
- 批量选择只作用于当前搜索、筛选结果中的可删除项，不选择被筛选隐藏的图片；
- “清空选择”清除全部已选项，包括当前被筛选隐藏的选择。

## Files to modify

- `src/modals/image-browser.ts` — 本地批量选择按钮、Shift 锚点、当前有序可选集合和 UI 刷新。
- `src/modals/remote-image-grid.ts` — 将 Shift 修饰键及稳定对象身份传给上层控制器。
- `src/modals/remote-image-browser.ts` — 远程批量选择、区间选择和锚点生命周期。
- `src/remote/delete-session.ts` — 提供原子化的批量/增量选择更新，失败时不破坏旧选择。
- `src/utils/selection-range.ts`（暂定）— 共享的纯区间选择算法。
- `src/i18n/en.ts`、`src/i18n/zh.ts` — 批量选择和清空文案。
- `styles.css` — 工具栏按钮在桌面和移动端的布局。
- `tests/selection-range.test.ts`（暂定）— 区间选择纯函数测试。
- `tests/remote-delete-session.test.ts` — 原子批量更新、无选择数量上限和资格校验回归测试。
- `.agents/skills/obsidian-image-manager/references/local-image-workflows.md` — 本地选择交互约定。
- `.agents/skills/obsidian-image-manager/references/hosting-and-remote.md` — 远程批量选择与限制约定。
- `.agents/skills/obsidian-image-manager/references/settings-and-ui.md` — 浏览器选择控件及移动端行为。

## Reuse

- `ImageBrowserModal.selectedPaths` 与 `filteredImages`：`src/modals/image-browser.ts`
- `getLocalReferenceState()`：`src/utils/local-orphan-management.ts`
- `RemoteDeleteSession.setSelected()` / `replaceSelection()`：`src/remote/delete-session.ts`
- `getRemoteDeleteUnavailableReason()`：`src/remote/delete-policy.ts`
- `RemoteImageBrowserView` 当前筛选、排序结果：`src/modals/remote-image-browser.ts`
- 独立孤立图片窗口现有“全选/取消全选”文案：`src/modals/orphan-images.ts`、`src/i18n/en.ts`、`src/i18n/zh.ts`
- 现有 `.local-image-delete-toolbar`、`.remote-delete-toolbar` 和卡片 `is-selected` 样式：`styles.css`

## Steps

- [x] 定义共享区间选择函数的输入、输出及锚点失效规则，并先补单元测试。
- [x] 明确批量选择使用当前筛选后的完整可选集合，Shift 仅由复选框触发，卡片预览点击路径保持不变。
- [x] 将远程批量选择更新改为原子操作，覆盖资格失败并支持无数量上限。
- [x] 在本地图片浏览器接入批量选择、清空和 Shift 区间选择。
- [x] 在远程图片浏览器接入相同交互，并确保渐进渲染不影响区间计算。
- [x] 补充中英文文案、键盘可访问性和响应式样式。
- [x] 更新本地、远程及 UI 参考文档。
- [x] 执行自动化与真实 Obsidian 交互验证。

## Verification

### Automated

- 区间选择：正向、反向、选择、取消、锚点缺失、不可选项跳过、区间外选择保持。
- 本地：批量选择只包含当前筛选结果中的孤立图片；状态变化后不保留不合格选择。
- 远程：资格判断不被绕过；超过 20 项仍可成功选择和创建 batch；任一对象失效时保持旧选择不变。
- 渐进渲染：区间算法使用完整结果顺序，不依赖当前已渲染的 60 张卡片。
- 运行 `npm test`、`npm run build`、`git diff --check`。

### Manual Obsidian acceptance

- 本地页验证搜索、引用筛选、升降排序后的批量选择和双向 Shift 区间。
- 远程页完成显式扫描后验证相同交互，以及 stale 索引、切换图床/prefix、重新扫描和超过 20 项的批量选择。
- 验证选择跨重绘保留但锚点在顺序变化后失效。
- 验证删除确认与本地双重复扫、远程精确数量确认仍保持原流程。
- 在桌面键鼠和移动端验证按钮布局；移动端通过批量按钮完成无 Shift 键场景。
