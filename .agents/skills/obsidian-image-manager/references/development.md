# 开发、验证与发布

按任务阅读：[验证选择](#验证选择) · [工具链约束](#工具链约束) · [发布](#发布) · [故障定位](#故障定位) · [文档维护](#文档维护)。

## 验证选择

命令以 [package.json](../../../../package.json) 为准。`npm run build` 包含 ESLint、TypeScript 检查和生产 esbuild；`main.js` 是生成物，不手工修改或提交。

| 改动 | 必要检查与完成边界 |
| --- | --- |
| 仅 Markdown / 项目 skill | 核对描述对应的源码；检查 frontmatter、相对链接与引用目标；`git diff --check`。不为纯文档变动安装项目依赖或运行产品测试。复杂流程调整可用只读场景演练检查路由与行动边界。 |
| 运行时代码、设置、样式 | 开发时运行受影响的测试；提交前完成 `npm test`、`npm run build`、`git diff --check`。构建已含 lint，不必再重复单跑。 |
| 依赖、构建、发布配置 | 阅读 package/lock、[esbuild 配置](../../../../esbuild.config.mjs)、[workflows](../../../../.github/workflows) 中受影响项；完成完整测试与构建，区分本地检查和实际 CI 结果。 |
| Obsidian / 服务商行为 | 自动测试之外，按本次改动验证真实宿主或专用 bucket/prefix；未执行的环境与路径明确标记，不以 mock 通过代替真实验收。 |

默认 Obsidian 测试库为 `/Users/imulan/workspace/test/obsidian-test`。操作前确认实际连接的库；使用独立测试文件，保留已有用户内容。服务商验收使用明确的测试配置和范围，不从日常配置推断删除授权。

已有通过结果在代码和环境相关条件未变化时可复用。没有依赖或宿主访问时报告具体缺口，继续独立的源码/文档检查。

### 测试导航

测试集中在 [tests/](../../../../tests)。按业务行为选用现有用例，新增测试验证可观察结果、冲突保护或协议边界，不匹配源码字符串或文档措辞。

| 范围 | 优先查找的测试文件（tests/ 下） |
| --- | --- |
| 命令 / 笔记范围 / URL 前缀迁移 | `commands.test.ts`、`file-menu.test.ts`、`note-scope.test.ts`、`scoped-reference-conversion.test.ts`、`url-prefix-migration.test.ts` |
| 粘贴 / 接力 / 空目录 | `managed-paste-pipeline.test.ts`、`obsidian-delegated-handoff.test.ts`、`paste-lifecycle.test.ts`、`empty-folder-cleanup.test.ts` |
| 本地解析 / 回收 / 重命名 / 整理 | `local-image-resolution.test.ts`、`local-reference-index.test.ts`、`local-orphan-management.test.ts`、`batch-rename.test.ts`、`batch-rename-repair.test.ts`、`external-rename-repair-coordinator.test.ts`、`image-reorganizer.test.ts` |
| 压缩 / 上传 / 模板 | `image-optimizer.test.ts`、`upload-compression-format.test.ts`、`upload-service.test.ts`、`explicit-upload-workflow.test.ts`、`upload-reference-manager.test.ts`、`native-upload-path.test.ts`、`reference-template.test.ts` |
| 服务商 / 远程安全 | `aliyun-oss*.test.ts`、`qiniu*.test.ts`、`s3*.test.ts`、`remote-*.test.ts`；重点选择签名、cursor、fresh/stale、删除与错误脱敏场景 |
| 设置 / UI | `settings-migration.test.ts`、`declarative-settings.test.ts`、`image-browser-selection.test.ts`、`remote-image-grid.test.ts`、`selection-range.test.ts`、各 `*-dialog.test.ts`、`i18n.test.ts` |

保持测试按业务域组织；不能为减少用例数合并不同协议的安全矩阵。具体保护条件见 [本地工作流](local-image-workflows.md)、[上传与远程管理](hosting-and-remote.md)、[设置与 UI](settings-and-ui.md)。

## 工具链约束

- 使用 npm；Node/npm 版本从 `package.json.volta` 读取。CI 与 Release 各自的 Node 版本以对应 workflow 为准，不能用本地配置推断远端环境。
- TypeScript 配置以 [tsconfig.json](../../../../tsconfig.json) 为准：类型库包含 DOM 和 ES2017，不直接使用 `flatMap`、`matchAll`、`Promise.finally` 等更高版本 API。
- `types: ["node"]` 为受桌面平台保护的 Node 导入显式加载类型。官方 scanner 的独立 TypeScript/ESLint 版本可能不同；本地 lint 通过不等于官方 scanner 通过。
- [eslint.config.mts](../../../../eslint.config.mts) 只对 `empty-folder-cleanup.ts` 放行 `fs/promises` 与 `path`。此范围不能扩大为一般文件访问；用途与宿主兼容证据见 [空附件目录清理](local-image-workflows.md#空附件目录清理)。
- `moment` override 只修复开发依赖树的 GHSA-4p3w-j4w9-5jqw，不改变宿主 runtime，也不打包进插件。上游解除旧版本固定后才评估移除；审计使用 `npm audit --registry=https://registry.npmjs.org`，部分镜像没有 audit endpoint。

### Obsidian / ESLint

- Promise 必须 await、return 或处理拒绝；事件 callback 的异步工作也要有失败处理。外部 JSON/request 数据在边界验证，避免 any 扩散。
- 用 `instanceof TFile/TFolder`、Obsidian DOM helpers、`activeDocument` 和 `window.*` timers；本地文件回收用 `fileManager.trashFile()`。
- paste/drop 注册处检查 `defaultPrevented`，只在业务处理器确认接管后调用 `preventDefault()`。
- 使用高于 manifest 最低版本的 API 前处理兼容边界；不能用 `eslint-disable` 压掉 `obsidianmd/*`。
- CSS、设置标题、IME 与 Modal 收尾规则统一见 [settings-and-ui.md](settings-and-ui.md#modal-通用约束)。

## 扩展与改动边界

- 按实际影响更新业务模块、调用方、测试和对应 reference。`main.ts` 保留接线；仅当跨模块产品契约变化时更新 [当前设计](../../../../docs/design/README.md)，不为每个小修复新建设计档。
- 新服务商的上传与远程对象能力独立实现；只有真实支持时才注册 list/folders/preview/delete。接入流程与协议约束见 [hosting-and-remote.md](hosting-and-remote.md)。
- 新设置同步类型、默认值、规范化、声明式 UI 和中英文文案；Modal/UI 改动只验证受影响布局与交互。详见 [settings-and-ui.md](settings-and-ui.md)。

## 发布

发布前阅读 [package scripts](../../../../package.json)、[版本同步脚本](../../../../version-bump.mjs)、[npm 配置](../../../../.npmrc) 与 [release workflow](../../../../.github/workflows/release.yml)。

**`npm version patch/minor/major` 是有远端副作用的发布流程，不是单纯修改版本号的本地命令。** 当前生命周期依次执行 build、同步并暂存版本文件、创建 commit/tag，最后由 `postversion` 执行 `git push origin master --follow-tags`。

1. 先确定本次授权是否包含推送与发布；已有授权直接沿用。仅本地准备或审查任务不要运行上述带推送的生命周期。
2. 核对工作树、当前分支、待发布提交和本地/远端 master。`postversion` 明确推送本地 master，不能假定它推送的是当前功能分支。
3. 完成代码对应的测试与构建；版本须在 package、manifest、versions 映射中一致。`.npmrc` 去掉 tag 的 `v` 前缀；workflow 要求 `x.y.z` 且等于 manifest version。
4. 发布后核对实际 workflow 结果和 Release 附件：`main.js`、`manifest.json`、`styles.css`、zip。tag 已推送不能单独证明构建或发布成功。

发布相关提交不添加 `Co-authored-by: Codex <codex@openai.com>`；此约定不改变普通代码提交的署名方式。

升级 Obsidian 最低版本时同步 manifest 与 versions 映射。Release workflow 有自己的构建与运行环境；它没有替代完整单测的步骤。

## 故障定位

| 现象 | 首个有效检查 |
| --- | --- |
| 插件不加载 / 命令不出现 | 实际安装目录的产物与 manifest，`src/commands.ts` 注册及 gate、`src/main.ts` 接线、插件 reload；旧命令边界见 [architecture.md](architecture.md#命令与兼容边界)。 |
| 设置不生效 | `normalizeImageManagerSettings()`、声明式 definition、保存副作用与 `update()`，不要只看默认值。 |
| 上传 / 远程操作失败 | 明确生产调用链与具体 provider；按 config/auth/permission/not-found/rate-limit/network/parsing/server 定位，输出脱敏摘要。 |
| 预览 / 删除不可用 | capability、hosting/prefix、previewAccess、fresh index、scan snapshot 与逐对象引用状态；见 [远程安全](hosting-and-remote.md#删除安全)。 |
| 官方行为扫描提示 | 对照被扫描版本的实际 `main.js` 与源码：区分能力提示、具体缺陷和审核结论；保留已确认的功能与安全边界，导入改名不能替代能力变化的验证。空目录限制见 [本地文档](local-image-workflows.md#空附件目录清理)。 |

## 文档维护

- `AGENTS.md` 保存工作约定，`CLAUDE.md` 只指向它和 canonical skill；`SKILL.md` 保存路由与全局硬边界。仅更新项目内指南，不顺带修改用户级 skills。
- references 保存当前行为、非显然约束和源码/测试入口。默认值、工具版本、CSS 尺寸等易变常量由其源码维护；规则与“已验证实现”明确区分。
- 同一交互或协议规则只在一个 reference 详述，其他位置链接它。修改链接目标、标题或拆分文件时同时检查所有入口。
- `docs/design/` 保存跨模块长期决策；历史材料从 [归档索引](../../../../docs/archive/README.md) 或 Git 追溯。README 描述用户能力，CHANGELOG 记录发布变化。
- Issue/PR 约定见 AGENTS.md；编辑表单/标签规则时直接读 [.github/ISSUE_TEMPLATE](../../../../.github/ISSUE_TEMPLATE)、[labeler 配置](../../../../.github/labeler.yml) 与 [workflow](../../../../.github/workflows/labeler.yml)。保留现有双语表单与两位数字排序前缀；优先级和进度标签按实际判断手工维护。标签自动化不代表审查结论或任务完成。
