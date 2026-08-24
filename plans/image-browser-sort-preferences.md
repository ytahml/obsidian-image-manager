# 图片浏览器排序方向与偏好记忆：实现计划

## Context

Issue #43 要求图片浏览器支持每个排序字段的升序/降序切换，并在重新打开浏览器或重载插件后恢复用户最后的排序字段与方向。当前本地浏览器固定名称/升序，远程浏览器也仅支持升序；两者支持的排序字段不同。

## Approach

- 为本地与远程浏览器保存独立的「字段 + 方向」偏好（已确认）；远程偏好在所有图床间共享（已确认），并以当前行为的名称/升序作为旧配置兼容默认值。
- 复用本地 `ImageScanner.sortImages()` 的既有排序方向参数；将远程 `getRemoteResults()` 扩展为接收方向。
- 在两个工具栏加入可访问、国际化的方向切换控件；只在内存结果上重排，不触发本地扫描或远程请求。
- 为同一主排序值定义稳定的次级名称/key 升序排序；远程对象缺失修改时间始终排在最后（均已确认），避免翻转数组导致同值对象顺序抖动。

## Files to modify

- `src/types.ts` — 定义本地/远程浏览器排序字段及 `{ field, order }` 偏好，写入 `ImageManagerSettings`、默认值与加载规范化。
- `src/modals/image-browser.ts` — 本地控件、读取/保存偏好和排序调用。
- `src/remote/result-page.ts` — 使用共享远程排序字段类型，接收方向并实现「缺失修改时间最后、同值 key 升序」的比较器。
- `src/modals/remote-image-browser.ts` — 读取共享（非按图床）远程偏好、方向控件、即时重排和延迟保存/关闭 flush。
- `src/i18n/en.ts`、`src/i18n/zh.ts` — 升序/降序切换的可见文本与 aria 文案。
- `styles.css` — 仅在现有工具栏 flex 规则不足以保持方向按钮可用时，添加受 `.image-browser-*` 限定的局部样式。
- `tests/settings-migration.test.ts`、`tests/remote-browse-session.test.ts`，以及新增或扩展本地排序单测。
- `.agents/skills/obsidian-image-manager/references/settings-and-ui.md`、`.agents/skills/obsidian-image-manager/references/local-image-workflows.md`、`.agents/skills/obsidian-image-manager/references/hosting-and-remote.md` — 同步持久化、交互和排序契约。

## Reuse

- `ImageScanner.sortImages(files, sortBy, order)`：本地排序已接受 `asc | desc`。
- `getRemoteResults(objects, keyword, sortBy, order)`：远程完整扫描集合的集中筛选/排序入口。
- `RemoteImageBrowserView.scheduleSettingsSave()` / `flushScheduledSettingsSave()`：远程视图已有的延迟保存和关闭时 flush 模式。
- `normalizeImageManagerSettings()`：旧 data.json 的默认兼容入口。

## Steps

- [x] 确认本地与远程浏览器分别记忆各自的字段与方向。
- [x] 确认远程偏好全图床共享；缺失修改时间最后、同值按 key 升序稳定排序。
- [x] 在 `src/types.ts` 定义不含无关 `reference-count` 的本地字段联合类型、远程字段联合类型和通用偏好结构；为两个偏好增加名称/升序默认值，并在规范化时拒绝未知字段/方向，回退默认值。
- [x] 在本地 Modal 初始化时用持久化偏好设置下拉框；为字段和方向变化更新 settings、调用安全的保存路径并重排；将既有 `ImageScanner.sortImages()` 方向参数改为实际偏好值。
- [x] 将远程 `getRemoteResults()` 扩展为接收方向：先筛选，再按选定字段比较；修改时间缺失始终末尾，主值相等时按 key 升序；不得以反转整个数组实现降序。
- [x] 在远程视图中从全局远程偏好初始化字段/方向控件；更新时只调用 `renderPageResults()`，复用现有 `scheduleSettingsSave()` 和 `close()` 的 flush，且不触发 scan 或改写图床配置。
- [x] 添加双语可见及 aria 文案；现有工具栏 flex 布局已满足按钮可用性，无需新增 CSS。
- [x] 补齐设置迁移、本地 asc/desc 和远程全部字段 asc/desc、关键字筛选、缺失时间、同值稳定次序的测试；同步三份参考文档。

## Verification

- 运行对应 Vitest 用例，随后执行 `npm test`、`npm run build`、`git diff --check`。
- 验证旧/损坏排序偏好载入后安全回退为名称/升序；本地与远程偏好互不覆盖，远程偏好切换图床后不变。
- 在 Obsidian 中验证本地/远程每个字段均可升降序，搜索与引用状态筛选组合正确，方向按钮可键盘操作且有正确的本地化 aria 文案。
- 验证切换方向不触发新的远程 `listObjects` 请求；修改偏好、关闭并重开浏览器及重载插件后，各页面恢复各自最后的字段与方向。
