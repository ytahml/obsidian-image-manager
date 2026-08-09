# 开发、测试、发布与回归

## 本地命令

```bash
npm install
npm run dev
npm test
npm run test:watch
npm run lint
npm run build
git diff --check
```

`npm run build` 依次执行 ESLint、TypeScript `noEmit -skipLibCheck` 和 production esbuild。`main.js` 是生成物，不手工编辑或提交。

Volta 固定 Node 22.x/npm 10.x；普通 CI 使用 Node 22.x。修改依赖、脚本或 CI 前同时检查 `package.json`、lockfile、`.github/workflows/` 和 release workflow。

## 测试策略

Vitest 测试应覆盖可观察行为与高风险协议，而不是源码字符串或文档措辞：

- 路径编码、命名、模板、引用正则状态与反向替换。
- 活动 Editor/非活动 Vault 内容读取。
- 本地 orphan fresh 校验、skip/fail 和回收站边界。
- UploadService 原生 objectKey/Custom URL-only、重试、失败摘要。
- OSS/Qiniu/S3 canonical signing、特殊字符、公开 URL 与连接测试。
- Provider cursor、文件夹 scope、错误脱敏。
- browse/preview/thumbnail session 的聚合、缓存、并发和 late response。
- 广义远程 URL 索引、alias/query/encoded slash、fresh/stale/abort。
- 删除确认、20 项、2 并发、stop、部分失败和 audit 串行写入。

保持测试文件按业务域组织；小纯函数可并入相邻业务测试，但不要为了减少用例数合并不同协议的安全矩阵。

## 关键 ESLint/TypeScript 约束

| 规则 | 正确做法 |
|---|---|
| no-floating-promises | await、return、catch/then 或显式 `void` |
| no-misused-promises | 非 async callback 内 `void` 启动 Promise |
| no-unsafe-* | 为 JSON/request payload 定义窄类型并校验 |
| no-tfile-tfolder-cast | `instanceof TFile/TFolder` |
| prefer-file-manager-trash-file | `fileManager.trashFile()` |
| prefer-window-timers | `window.setTimeout/clearTimeout` |
| prefer-active-doc | `activeDocument` |
| prefer-create-el | `createEl`、`createDiv`、`createSpan` |
| editor-drop-paste | defaultPrevented guard + handled boolean |
| no-unsupported-api | 不直接调用高于 minAppVersion API |
| sentence-case | 英文 UI sentence case |

其他注意：

- TypeScript lib 是 ES2017，不用 `flatMap`、`matchAll`。
- `JSON.parse`/request response 不能任由 any 扩散。
- `Array(count).fill()` 可能造成类型不安全，使用 `Array.from`。
- 不能用 `eslint-disable` 绕过 `obsidianmd/*`。
- CSS 不用 `!important`、重复属性或无作用域全局 selector。

## 新功能实施清单

1. 确认需求属于本地文件、上传、远程管理、设置/UI 中哪个边界。
2. 涉及删除、网络、持久化、数据模型或跨模块流程时先更新/新增 `docs/design/` 契约。
3. 在公共逻辑模块实现并补行为测试，`main.ts` 只接线。
4. 更新 settings types/defaults 与 Obsidian 1.13 声明式 UI。
5. 更新中英文 copy、README 用户能力、skill/reference。
6. 验证桌面和移动布局、IME、异步 loading、session cleanup。
7. 跑完整测试、build、diff check。

## 新增图床 Provider

上传：

1. 定义 provider-specific config 与 `HostingType`。
2. 实现 `UploaderBase.upload/testConnection`，使用 `requestUrl` 与 Web Crypto。
3. 注册 uploader factory，接入共享 upload-path 与 `UploadService`。
4. 原生成功返回 objectKey；为 URL/path/canonical signing 补 fixture 测试。

远程管理：

1. 单独实现 `RemoteObjectProvider`，只声明真实 capability。
2. `RemoteRequestClient` 可注入，cursor 保持 opaque，错误映射并脱敏。
3. 定义 source/public/alias URL mapping。
4. 分别实现 list/folders/preview/delete，不从上传 URL 猜管理协议。
5. 复用公共 browse/preview/thumbnail/reference/delete session，不复制安全门禁。
6. 在 HostingConfigModal capability gate、i18n、README、设计档中同步。
7. 用专用 bucket/prefix 做真实环境验收；自动化通过不能替代服务商验收记录。

## 新增 Modal 或设置

Modal：

- 参考相邻 Modal 和 `settings-and-ui.md`。
- Enter 先检查 IME，Escape 取消。
- Promise callback 不浮动，pending 时禁重复。
- close 时清 DOM、listener、observer、URL/session。
- 避免直接 document、全局 timer、static style 与手写 heading。

设置：

- types/defaults、声明式 definitions、i18n、保存副作用同步。
- 旧 data 缺字段时有安全默认。
- 影响其他设置可见性时刷新，并测试门控。

## 发布

标准版本命令：

```bash
npm version patch
npm version minor
npm version major
```

生命周期：

1. `preversion` 运行 build。
2. `version-bump.mjs` 同步 manifest version 与 versions map。
3. 暂存 manifest、versions、package files。
4. npm 创建版本 commit/tag。
5. `postversion` 推送 master 与 tag。

规则：

- tag 与 `manifest.json.version` 完全一致，无 `v`。
- release workflow 会拒绝非 `x.y.z` 格式或与 `manifest.json.version` 不一致的 tag，避免误打 tag 创建 Release。
- `versions.json` 映射版本到最低 Obsidian 版本。
- Release 上传 `main.js`、`manifest.json`、`styles.css` 和 zip。
- 若使用了更高 Obsidian API，同步 `minAppVersion` 与 versions。

## 必须保留的回归知识

### IME

命名、重命名、确认等 Enter handler 必须检查 `isComposing`，否则中文选词会误提交。

### 重命名路径

Obsidian 内置更新可能剥离 Markdown 目录。普通 rename 事件等待约 100ms 后修复；整理期间用 `isReorganizing` 跳过，避免覆盖正确的新路径。

### 引用计数

预览显示全部引用次数与笔记数，不能只按 note 去重后当引用数。

### 相对路径

整理和重命名依据 `imagePathBase` 与 note directory 计算；不能把 Vault 绝对路径写进 note-relative 引用。

### URL 替换

上传后只替换本地引用；同名 remote URL、protocol-relative、data、blob 必须跳过。

### 签名

特殊字符下实际请求 URL 与 canonical path/query 必须同源。OSS 空字段换行、Qiniu management 尾部双换行、S3 query `%20`/排序都有回归测试，不可凭“看起来合理”改写。

### 远程事实

上传成功、删除请求成功、audit 记录都不能证明对象当前存在/永久删除；远端事实只来自用户重新扫描。

### 删除

不要把“当前 Vault 未检测到引用”文案或内部状态改成“安全删除”。外部网站、其他 Vault 和应用仍可能引用对象。

## 故障定位

- 插件不加载：检查插件目录中的 `main.js`、manifest id `md-image-manager` 和 build 结果。
- 命令不出现：检查 active file 条件、Markdown gate、browser enable 和 reload。
- 设置不生效：检查 default、声明式 definition、await save 与 `update()` 刷新。
- 上传失败：先测试连接，再核对 endpoint/region/bucket/public base；只输出安全摘要。
- 远程扫描失败：按结构化 code 区分 config/auth/permission/not-found/rate-limit/network/parsing/server。
- 预览不可用：核对图片扩展名、storage class、preview access、public base 与私有 get 权限。
- 删除不可选：依次检查 management enabled、capability、fresh index、hosting、prefix、scan snapshot、reference state。

## 文档维护

- `SKILL.md` 只保存入口、全局硬边界和按任务触发的指针。
- references 保存当前实现知识、开发约束和难以从代码直接推导的陷阱。
- `docs/design/` 只保存按产品能力命名的现行长期决策；不使用 Issue/PR/阶段编号，不保存实施流水。
- 完成功能把持久决策合入现行契约并移除临时计划；历史证据从 Git 和 `docs/archive/README.md` 追溯。
- README 描述用户可见能力；CHANGELOG 保存发布历史。行为变化时同步受影响层，但不复制同一事实。

## Issue 与 PR 分类

- Issue 与 PR 用于协作和跟踪，不是产品事实来源；功能文档按能力命名，不按票号命名。
- 标题和正文默认使用中文，除非用户、仓库约定或协作者需要其他语言。
- Issue 提供中英双语的 bug、功能建议、使用问题和文档改进表单；`Other / 其他` 保留普通自由编辑入口。
- 模板文件使用两位数字前缀固定展示顺序：Bug、Documentation、Feature、Question、Other；新增或重命名模板时保持该顺序。
- 表单会自动添加对应的 `bug`、`enhancement`、`question` 或 `documentation` 标签。
- PR labeler 只添加标签：`fix/` 分支为 `bug`、`feat/` 分支为 `enhancement`、`docs/` 分支或文档路径为 `documentation`、`.github/` 改动为 `ci`。它不自动评论、指派、关闭或调整优先级。
- `high`、`medium`、`low`、`in progress` 与 `needs design` 依赖实际判断，始终手动维护。
