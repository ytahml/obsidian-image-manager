# 图片浏览器选择交互调整（Issue #49）

## Context

- 当前本地卡片和远程缩略图单击预览；复选框支持逐项选择和 Shift 区间操作。
- 用户确认：选择范围和删除资格不变；改为单击选中、双击预览，增加 Ctrl/Cmd 逐个多选；单击不清除其他选择（包括隐藏项）。
- 计划已批准并进入实施；未安装依赖，未提交、合并或发布。
- 已核对基线：`5a35f47`，工作分支 `ytahml/feature-2`；本次规划开始时工作树干净。

## Approach

- 本地与远程浏览页采用一致卡片交互；不扩大到专用孤立图片窗口，不增加设置项。
- 继续复用当前可选资格、选择集合、工具栏及删除重验，不引入通用图片选择集合。
- 按最新问题反馈：普通单击切换当前项选中/取消；Ctrl/Cmd + 单击同样切换当前项选中/取消。不清空其他可见或隐藏选择。复选框继续支持无修饰键取消和 Shift 区间操作；按最新反馈，卡片同步支持 Shift 区间选中/取消，Ctrl/Cmd + Shift 只追加区间。
- 卡片双击打开预览；不可选但可预览的图片仍可双击预览，远程预览能力限制保持不变。
- 卡片选择即时执行；共享处理器保存首击产生的撤销回调，原生第二次 click 经现有资格校验恢复首击实际改变的各项选择（含 Shift 区间）及锚点，再由 dblclick 打开预览。双击不遗留首击的选择效果，不使用猜测系统双击间隔的定时器，不恢复整个选择集合。复选框、预览入口、远程重试按钮的 click/dblclick 与卡片操作隔离。
- 保留键盘预览能力；触屏提供无需双击的明确预览入口。具体入口样式沿用现有按钮模式。
- 搜索结果更新必须清除锚点，包括防抖期间新建立的锚点，但不清空已有选择。保留筛选/排序的锚点重置规则；Shift 区间基于完整结果而非 DOM。

## Files to modify

- `src/modals/image-browser.ts`：本地卡片事件、预览入口、选择状态同步。
- `src/modals/remote-image-grid.ts`：远程卡片事件、键盘和子控件隔离。
- `src/modals/remote-image-browser.ts`：仅在事件适配需要时调整选择回调。
- `src/utils/selection-range.ts`：优先保留现有集合运算；若需共享卡片手势转换，采用小型纯函数，不引入另一套选择状态。
- `src/i18n/en.ts`、`src/i18n/zh.ts`、`styles.css`：同步操作提示、预览入口、焦点样式。
- `tests/image-browser-selection.test.ts`、`tests/selection-range.test.ts` 及新增远程卡片事件测试：覆盖用户手势及事件序列。
- `.agents/skills/obsidian-image-manager/references/local-image-workflows.md`、`settings-and-ui.md`、`hosting-and-remote.md`：更新旧的“卡片单击预览”契约。

## Reuse

- `src/utils/selection-range.ts` 的 `applySelectionGesture()`：不可选项过滤、集合增减、Shift 区间与锚点。
- `src/modals/image-browser.ts` 的 `applyLocalSelectionGesture()`、`syncLocalSelectionControls()`、现有预览 actions 与删除重验。
- `src/modals/remote-image-browser.ts` 的 `applyRemoteSelectionGesture()`、`getDeleteContext()`、`openPreview()`。
- `src/modals/remote-image-grid.ts` 的 `syncSelection()` 与重试按钮 `stopPropagation()` 模式；补齐双击与其他交互控件隔离。
- 现有 Vitest/mock 方式；目前本地浏览器选择测试只覆盖搜索防抖期间的锚点失效，需要补生产卡片事件测试。

## Steps

- [x] 交互矩阵按后续反馈修订：普通及 Ctrl/Cmd 单击切换当前项，双击保持操作前选择和锚点并预览；复选框和 Shift 区间保持现有行为。
- [x] 实现最小共享手势处理，保留当前资格与 Shift 复选框语义。
- [x] 接入本地及远程卡片，处理双击、子控件、键盘与触屏预览入口。
- [x] 补充手势单测及生产卡片事件回归测试。
- [x] 同步中英文文案和相关 references。
- [x] 自动验证并部署到用户指定测试库 `/Users/imulan/workspace/test/obsidian-test`；尝试真实 Obsidian 验收，不可自动测试时按用户授权移交手动验收，分开记录证据；不自动提交、合并或发布。

## Verification

- 普通单击 A、B 后两项均选中，再次独立单击 A 取消 A；Ctrl/Cmd 单击 A 选中 A，再次独立 Ctrl/Cmd 单击取消 A；全过程不清除其他可见或隐藏选择。
- 隐藏选择保留；不可选项不能进入集合；复选框和 Shift 区间现有行为不退化。
- 测试真实事件顺序 `click(detail=1) → click(detail=2) → dblclick`，预览恰好打开一次，目标项恢复首击前的选择状态及锚点；同时覆盖原本未选和已选的情况。
- 复选框/标签、重试、预览按钮不冒泡触发额外选择或双重预览；键盘与触屏可完成选择及预览。
- 远程渐进渲染、搜索/排序/筛选、扫描失效、切页和关闭后状态正确；无新增 list 请求或选择触发的预览请求。
- 删除边界保持：本地确认前与执行前复扫；远程 fresh/scope/snapshot 等逐对象验证、精确数量确认、两并发、无自动重试。
- 实施后运行 `npm test`、`npm run build`、`git diff --check`，对变更 TS 文件主动检查诊断。
- 真实 Obsidian 手动验收本地/远程、Ctrl/Cmd、双击、键盘与移动端；不为验收执行真实删除。真实 Provider 验收单独报告，未覆盖不声明通过。

## Confirmed decision

用户后续反馈独立单击需要取消已选项、快速双击不应自动选中；本轮据此修正普通单击切换和双击恢复，最新反馈进一步要求 Ctrl/Cmd 独立单击也能取消当前已选项，搜索结果更新清锚点保持不变。继续使用已授权测试库；真实远程页及移动端验收独立移交用户。

## 首轮部署证据（本次单击/双击修复前）

- 实现：本地/远程共用 `getCardSelectionChecked()`，保留现有资格重验和选择集合；无需改动 `remote-image-browser.ts` 或 Provider 协议。
- 自动验证：`npm test` 为 49 文件、328 项通过；`npm run build`（ESLint、TypeScript、production esbuild）通过；`git diff --check` 通过。
- 回归覆盖：35 项直接相关用例含生产卡片事件绑定、远程生产选择适配器、隐藏选择、普通/Ctrl/Cmd 幂等追加、双击序列、复选框/标签、Shift 跨渐进渲染区间、扫描过期、预览能力、重试事件隔离及远程销毁后事件。新增本地与远程实际搜索结果应用边界的锚点重置测试；本地同时覆盖防抖期间重新建立的锚点。
- 测试限制：新增 DOM adapter 是 Node 中的最小事件模型，不代替真实鼠标/触屏、原生键盘激活、布局或宿主预览验收。
- 主动 LSP 检查：最新 8 文件检查无错误报告，其中 4 个 clean、4 个 push-only 重检未确认；完整 TypeScript 构建已通过，不把静默 LSP 当作全部文件通过证据。
- 部署：`main.js`、`manifest.json`、`styles.css` 已写入 `/Users/imulan/workspace/test/obsidian-test/.obsidian/plugins/obsidian-image-manager/`，SHA-256 与当前构建一致；已通过目标库 CLI 重载 `md-image-manager`。部署未覆盖 `data.json`。
- 可恢复备份：原三个文件为指向 `/Users/imulan/workspace/web/obsidian-image-manager/` 的符号链接，已保存链接、目标文件原内容和部署清单到 `/Users/imulan/workspace/test/obsidian-test/.obsidian/plugin-build-backups/md-image-manager-20260920-083751/`；只替换测试库内条目，未写入链接指向的另一仓库。
- 真实 Obsidian 1.13.4 本地页：指定库 CLI 现已可用，经生产 `browse-images` 命令打开。真实 DOM 事件验证普通/Ctrl/Cmd 追加与重复点击、搜索结果保留选择并清除 Shift 锚点、搜索后 Shift 仅改变目标项、双击只开一个真实预览、图片实际加载、独立预览按钮不改变选择；CDP 原生鼠标输入另外验证 Cmd 追加/重复点击和双击预览。验收后用原生 Escape 关闭两层测试 Modal，移除临时测试状态，未修改笔记或执行删除。
- 真实远程页、移动端及 Provider：未验收，不执行云端扫描或删除；按用户授权移交手动验收，不以 Node 自动测试替代该证据。

### 手动验收交接

- 在测试库打开图片浏览器；普通单击选中，再次独立单击取消；Ctrl/Cmd 单击同样切换当前项。分别双击未选中和已选中的图片，关闭预览后选择应与双击前一致，原 Shift 锚点保持不变。
- 搜索结果更新后，已有选择仍保留；第一次 Shift 卡片或复选框操作只影响当前项，不沿用旧结果的锚点。
- 远程页在用户选定的测试图床/范围显式扫描后检查相同交互；无需执行删除。
- 移动端确认复选框和独立预览按钮可触达、双击不是唯一预览入口。
- 提交、合并、发布：均未执行。

## 单击/双击冲突修复证据

- 普通独立单击切换当前项，Ctrl/Cmd 只追加；每张卡片使用共享 `createCardSelectionHandler()` 保存首击前状态，在原生第二次 click 时经既有资格校验恢复该项与锚点，再打开预览。不引入定时器，也不恢复整个选择集合。
- 自动验证：49 个测试文件、335 项通过，其中 42 项为选择/卡片相关测试；完整 ESLint、TypeScript 和 production build 通过，`git diff --check` 通过。LSP 9 文件无错误报告，4 个 clean、5 个 push-only 未确认，以完整 TypeScript 检查补充。
- 双击矩阵覆盖已选/未选、普通/Ctrl/Cmd、原锚点、其他可见及隐藏选择、孤立资格；远程引用索引在两次 click 之间变 stale 时，恢复选择仍不能绕过资格校验。
- 已重新部署并重载指定测试库的 `main.js`、`manifest.json`、`styles.css`；上一构建备份至 `.obsidian/plugin-build-backups/md-image-manager-click-fix-20260920-091012/`，未覆盖 `data.json`。
- 真实 Obsidian 本地页通过 CDP 原生输入验证：首次单击选中，隔开后再次单击取消；Cmd 连续点击保持追加；双击未选图片仍未选、已选图片仍已选、其他选择不变，预览各只打开一次；双击后的 Shift 操作仍使用双击前锚点。
- 验收后关闭预览、清空测试选择、移除临时状态，保留测试库图片浏览器方便用户继续验证。未改动笔记或执行删除。远程 Provider 与移动端仍未作真实验收，提交/合并/发布均未执行。

## 卡片 Shift 区间补充与部署证据

- 实现：本地/远程卡片把 Shift 传递给原有区间入口；目标未选时选中区间，已选时取消区间，Ctrl/Cmd + Shift 只追加区间。完整结果顺序、不可选项过滤、隐藏选择、搜索清锚点及删除重验保持不变。
- 双击：选择入口返回撤销回调；共享 `createSelectionUndo()` 只记录首击实际增减的 ID，不覆盖其他变化。Shift 双击恢复混合选择及原锚点，恢复项仍重新验证当前资格；远程恢复仍经 `replaceSelection()` 校验。
- 自动验证：49 文件、347 项测试通过；完整 ESLint、TypeScript 与 production build 通过，`git diff --check` 通过。新增覆盖双向区间、跨渐进批次、跳过已引用项、取消区间、混合选择双击回滚、实时资格变化；本地/远程搜索后卡片 Shift 不复用旧锚点。LSP 9 文件无错误报告，4 个确认 clean、5 个 push-only 未确认。
- 部署：仅 `main.js` 发生变化，已更新并重载指定测试库；三个产物 SHA-256 均与源码构建一致，未覆盖 `data.json`。上一版产物及部署清单保存在 `.obsidian/plugin-build-backups/md-image-manager-shift-card-20260920-100153/`。
- 真实 Obsidian 本地验收：生产命令打开 351 张卡片，通过 CDP 原生输入验证卡片 Shift 选中/取消区间（跳过中间已引用项）、Shift 双击恢复原本已选与未选目标的完整混合状态且各打开一个预览、Cmd 追加不取消。测试驱动原先假定的关闭按钮 selector 不存在，改用原生 Escape 后完成验收；并非产品交互失败。
- 验收结束：选择恢复为空，临时浏览器与预览全部关闭，恢复测试前无 Modal 状态；视口仍为 1472×962 / DPR 2，无布局仿真残留，未修改笔记或执行删除。
- 未覆盖：真实远程 Provider 交互及移动端仍交用户验收；不以 DOM 单测替代。未提交、合并或发布。

## Ctrl/Cmd 逐项取消修复（最新）

- 最新反馈取代旧的“Ctrl/Cmd 只追加”规则：普通及 Ctrl/Cmd 独立单击都切换当前项，保留其他可见/隐藏选择；Shift 与 Ctrl/Cmd + Shift 区间规则不变，双击仍恢复首击前状态并预览。已同步双语提示、README 和当前技能参考。
- 回归：本地、远程均验证按住同一修饰键连续独立点击时选中→取消→再选中，复选框和高亮同步，其他选择保留；原有普通/Ctrl/Cmd 双击及 Shift 回归继续通过。49 文件、347 项测试、ESLint、TypeScript、production build、diff check 全部通过。LSP 6 文件无错误报告，4 个确认 clean、2 个 push-only 未确认。
- 部署：仅更新测试库 `main.js` 并重载；上版三个产物和清单备份于 `.obsidian/plugin-build-backups/md-image-manager-ctrl-toggle-20260920-101405/`，未覆盖设置。
- 实机：macOS Obsidian 通过原生 CDP Cmd 点击验证逐项切换、其他选择保留、已选/未选目标双击均恢复状态并只开一个预览。Ctrl 主点击通过生产卡片的合成 DOM 事件验证，不能宣称 Windows/Linux 原生 Ctrl 已验收。
- 宿主限制：本机原生 Ctrl + 点击实际只派发 `contextmenu`，不派发 `click`；不劫持系统右键语义，macOS 应使用 Cmd。诊断监听器已移除；测试选择清空，临时弹窗关闭，视口未改变。
- 真实远程 Provider、移动端及其他平台原生 Ctrl 仍未验收；未删除图片、提交、合并或发布。
