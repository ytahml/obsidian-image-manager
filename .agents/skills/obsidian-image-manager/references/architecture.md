# 项目架构与业务边界

## 产品范围

插件围绕 Obsidian Markdown 图片完成五类业务：

1. 保存、命名与压缩粘贴/拖放图片。
2. 解析、转换、追踪并修复本地图片引用。
3. 浏览、筛选、预览、重命名、整理和清理本地图片。
4. 将图片上传到四类图床，并按设置复制或替换引用。
5. 对三类原生图床显式扫描远程对象、预览、定位引用并受保护地删除孤立对象。

Custom HTTP 只有上传协议。图床迁移和恢复本地引用不属于当前可用功能。

## 目录职责

```text
src/main.ts                 Plugin 生命周期、命令、事件、跨模块编排
src/settings.ts             Obsidian 1.13 声明式设置定义、图床自定义渲染
src/types.ts                持久化设置与公共本地域类型
src/modals/                 本地/远程浏览、预览、配置、命名与确认 UI
src/utils/                  路径、引用、扫描、压缩、整理、重命名与本地清理
src/lifecycle/              managed paste 管线、delegated 事务匹配、串行效果、rename 批处理与近期变化保护
src/uploaders/              上传器、上传路径、结果摘要、UploadService/Queue
src/remote/                 Provider、请求/错误、扫描/预览/删除会话、引用索引
src/oss/ src/qiniu/ src/s3/ 服务商签名与共享请求目标
src/i18n/                   中英文词条与插值
```

边界原则：

- `main.ts` 只保留 Obsidian 入口与业务编排；可测试的匹配、转换、安全策略和协议逻辑必须下沉。
- `UploaderBase` 只负责上传；list/preview/delete 权限由独立 `RemoteObjectProvider` 表达。
- Provider factory 通过 capability 决定 UI 是否开放能力，不能在 UI 中复制图床名称判断。
- 签名层必须从同一组规范化值生成实际 URL 与 canonical URI/query/headers，不能分别拼接。

## 稳定命令入口

命令 ID 发布后视为兼容接口，不随文案调整而改名。

| ID | 行为与显示条件 |
|---|---|
| `browse-images` | 打开本地/图床图片浏览器；受 `enableImageBrowser` 门控 |
| `compress-current-image` | 仅活动文件为受支持图片时可用 |
| `convert-reference-format` | 当前笔记 Wiki 图片引用转 Markdown |
| `convert-reference-format-vault` | 全库 Wiki 图片引用转 Markdown |
| `upload-to-hosting` | 上传当前图片；运行时检查 Markdown 模式与图床配置 |
| `upload-note-images` | 上传活动 Markdown 笔记中的本地图片；Markdown 模式下可用 |
| `batch-upload` | 上传全库受支持图片 |
| `find-orphan-images` | 打开专用孤立图片窗口 |
| `rename-image` | 仅活动文件为图片时可用 |
| `reorganize-images` | 整理活动 Markdown 笔记 |
| `convert-to-md` | 当前 Markdown 笔记中的 Wiki 图片转 Markdown |
| `migrate-images` | 保留的占位命令；当前仅显示未实现提示 |

文件菜单还为 Markdown 文件提供笔记上传、整理和转 Markdown，为文件夹提供整理。

## 生命周期与事件

`onload()` 顺序：

1. 加载并合并 `DEFAULT_SETTINGS`，规范化删除历史。
2. 设置 locale。
3. 创建 RefConverter、ImageOptimizer、UploadService、managed paste 管线、delegated 生命周期协调器、BatchRename、RemoteReferenceIndex 和审计 writer。
4. 按设置注册 ribbon、命令与设置页。
5. 注册 paste/drop、Vault create/modify/delete/rename 和 file-menu 事件。

Vault 中 Markdown 文件变化会使远程引用索引 stale。delegated paste/drop 先冻结来源笔记引用基线，再通过事务差异把新 `TFile` 与唯一新增引用配对，同来源笔记效果串行；图片 rename 链按最终路径合并为一个串行修复批次，并受 delegated 活跃/近期保护门禁约束。整理期间由 `isReorganizing` 阻止修复器与内部移动冲突。

`ManagedPastePipeline` 封装 managed 模式从命名、路径、压缩、落盘、引用插入到可选上传及安全回收的完整事务。`main.ts` 只过滤事件输入、在 managed/delegated 之间分流，并注入上传引用与跨笔记替换等跨模块能力；资源整理继续通过插件公开的 `resolveImagePath()` 复用同一条路径规则。

## 核心类型

### 图床

```text
HostingType = aliyun-oss | qiniu | s3 | custom
ImageHostingConfig
  id/name/type/enabled
  provider-specific config
  uploadPath
  urlPrefix
  remoteManagement?
```

`urlPrefix` 是公开访问 URL 基础路径，可包含 bucket 或目录，不是上传 endpoint。`remoteManagement` 缺失时旧配置默认关闭。

### 上传结果

`UploadResult` 包含 success、url、objectKey、error、originalPath。Aliyun OSS、Qiniu、S3 成功必须有稳定 `objectKey`；Custom 只要求 URL，不能从 URL 猜 key。

统一操作层还补充 hostingId、attempts、原始/上传大小，供当前操作汇总和远程会话失效使用；不持久化上传清单。

### 远程对象

- capability：`list | folders | preview | delete`
- 引用状态：`referenced | possibly-referenced | not-referenced-in-current-vault | unmappable`
- 对象元数据：hostingId、完整 key、size，可选 modified/etag/mime/storageClass/availability
- cursor 属于 Provider，不透明透传
- delete result 只能保守表达 `permanent | delete-marker | unknown`
- reference index 只有 `empty | fresh | stale`

`possibly-referenced` 是兼容状态，当前可靠 URL 扫描统一归入 `referenced`。

## 关键业务数据流

```text
paste/drop
  → 命名/路径/冲突处理
  → 可选 Canvas 压缩
  → Vault 保存与引用插入
  → 可选 UploadService
  → 替换当前与其他笔记的本地引用
  → 可选回收本地文件并清理空的直接附件目录
```

```text
单图 / 笔记 / 全库 / 粘贴上传
  → UploadService
  → createUploader
  → 结构化操作结果
  → 默认或自定义引用
  → 仅失效匹配 hostingId 的已打开远程会话
```

```text
显式远程扫描
  → Provider.listObjects
  → RemoteBrowseSession 聚合
  → RemoteReferenceIndex 分类
  → 本地搜索/排序/筛选与渐进卡片
  → viewport 缩略图/大图预览
  → fresh 门禁下的 RemoteDeleteSession
  → 脱敏诊断记录
```

## 持久化与隐私

- 所有插件设置保存在 Obsidian 插件 data 中，不访问 Vault 外文件。
- 图床凭据随配置持久化；任何新增网络能力都必须有明确用户用途和帮助文案。
- 不收集 telemetry，不上传 Vault 内容供分析，不获取或执行远程代码。
- `remoteDeleteHistory` 最多 200 条，只保存完成时间、hostingId、key、成功状态和稳定结果码；没有历史 UI，也不是远程事实来源。
