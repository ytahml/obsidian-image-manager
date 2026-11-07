# 本地图片与引用工作流

按任务阅读：[粘贴与路径](#粘贴与拖放) · [引用解析](#引用解析与转换) · [压缩](#canvas-压缩与格式) · [浏览器](#本地图片浏览器) · [孤立回收](#孤立图片与安全清理) · [粘贴事务](#粘贴事务与委托接力) · [空目录](#空附件目录清理) · [重命名与整理](#重命名与资源整理)。

源码入口在 [utils/](../../../../src/utils)、[lifecycle/](../../../../src/lifecycle) 与 [modals/](../../../../src/modals)：引用解析从 `local-image-resolution.ts` / `ref-converter.ts` 开始，删除资格从 `local-reference-index.ts` / `local-orphan-management.ts` 开始，粘贴从 `ManagedPastePipeline` / `ObsidianDelegatedHandoff` 开始。对应测试见 [测试导航](development.md#测试导航)。

## 粘贴与拖放

事件注册必须先检查 `evt.defaultPrevented`。业务处理器只判断是否接管并返回 boolean，由注册处调用 `preventDefault()`，以满足 Obsidian editor paste/drop 规则。

流程：

```text
ClipboardEvent/DragEvent
  → 过滤 image/* 文件
  → main.ts 按 localManagementMode 分流
  → ManagedPastePipeline
  → generateImageFileName
  → 可选 ImageNamePromptModal
  → savePastedImage
      → resolveImagePath
      → ensureDirectory / ensureUniquePath
      → 可选压缩
      → vault.createBinary
      → 插入 Markdown 或 Wiki 引用
      → 可选 autoUploadAfterPaste
```

### 命名模板

`imageNamingTemplate` 支持：

| 变量 | 语义 |
| --- | --- |
| `{noteName}` | 当前笔记 basename；没有笔记或清理后为空时回退 |
| `{date}` | `YYYY-MM-DD` |
| `{time}` | `HHmmss` |
| `{timestamp}` | 毫秒时间戳 |
| `{year}` `{month}` `{day}` | 日期分量 |
| `{counter}` | 插件会话内计数 |

清理规则移除用户扩展名、替换空格、去除 `/\:*?"<>|` 等不安全字符、合并连字符并清理首尾；空结果回退 `image`。命名 Modal 的 Enter 必须处理 IME composing。

命名和本地路径模板只展开原模板中的变量一次。来自笔记名、笔记目录和文件名的 `$&` 等美元替换符或 `{year}` 等字面文本不会作为替换指令或新的变量再次执行；未知模板变量保留原文。

### 本地路径模板

`imagePathTemplate` 支持 `{noteName}`、`{notePath}`、`{filename}`、`{year}`、`{month}`、`{day}`、`{timestamp}`。

- `imagePathBase=vault`：相对 Vault 根。
- `imagePathBase=note`：相对当前笔记目录。
- 通常递归创建中间目录。移动端受管自动上传且关闭本地副本、存在可用图床时，若配置目标目录在磁盘上尚不存在，则先保存到当前笔记所在的已有目录（根笔记使用 Vault 根），不创建附件目录。目标已存在或不满足这些条件时仍按模板保存。
- 同名文件使用 `-1`、`-2` 等后缀；并发创建冲突时用时间戳重试。
- Markdown 引用应相对当前笔记，Wiki 引用使用文件名。

## Markdown 路径编码

`encodePathSegments` 逐段编码会改变 Markdown 或 URL 解析的 ASCII：空白、控制字符、`% # ? ( ) [ ] " < > \ ^` { | }`。

保留：

- `/` 路径分隔符
- Unicode
- RFC 3986 path 中安全的 ASCII，例如字母数字、`-._~!$&'*+,;=:@`

`decodePathSegments` 逐段容错解码已有本地引用；无效 `%` 转义不得使整个路径解析失败。上传 URL 展示使用独立 `makePublicUrlReadable`：只还原 path 中合法的非 ASCII UTF-8，query、fragment 和敏感 ASCII 编码保持不变。

## 引用解析与转换

`RefConverter` 处理：

- Markdown：`![alt](path)`
- Wiki：`![[path|alt]]`

核心约束：

- 全局正则每次解析前重置 `lastIndex`。
- 合并两类引用后按字符位置排序并记录零基 line/col。
- 批量替换从后往前，避免前一处替换改变后续 offset。
- Wiki → Markdown 时按文件名解析 Vault 路径，并依据当前笔记计算相对路径。
- Markdown → Wiki 的内部转换器只保留文件名；当前用户命令只公开 Wiki → Markdown。
- alt 等于文件 basename 时避免生成冗余 Wiki alt；Markdown 输出保留可理解的 alt。

会移动文件、改写引用或上传文件的本地工作流共享来源感知解析语义：Markdown 目标先解包尖括号并逐段容错解码，再统一分类 remote；Wiki 保持宿主字面路径。优先使用 `metadataCache.getFirstLinkpathDest(target, source.path)`；无权威结果时必须收集并按路径去重明确的 Vault-root 与来源目录相对候选，只有一个命中才可解析，多个命中返回歧义。只有明确候选均未命中且 basename 在 eligible lookup 中唯一时才允许兼容回退，不能依赖 `vault.getFiles()` 顺序任选首项。Wiki → Markdown 转换对 remote、缺失或歧义引用保持原文，并按实际转换/跳过数量报告。只读 `LocalReferenceIndex` 在歧义时继续保护全部候选。

范围转换命令只有 `convert-reference-format`：命令弹窗默认全库，也可选递归文件夹或文章；文章/文件夹右键直接转换被点击范围。三种范围通过 `note-scope.ts` 选择 Markdown 笔记，文件夹边界不能误包含相邻同名前缀。每篇笔记用 `readNoteSnapshot()` 读取实时 Editor 或 Vault 内容，再通过 `writeNoteSnapshot()` 重验 Editor 集合、内容、路径和文件身份；多个 Editor 分歧、并发修改、重命名、删除或读写失败保留原文。单篇失败不阻断其他笔记，不承诺跨文件原子事务。转换只处理 Wiki 图片，不移动或删除附件。

远程引用索引不只依赖 `RefConverter`；它还有独立 URL 扫描能力，详见远程文档。

## Canvas 压缩与格式

`ImageOptimizer` 提供 `compressImage`、`convertFormat`、`getImageInfo`：

- SVG 压缩直接返回原数据；格式转换拒绝 SVG。
- 新受管附件和上传载荷的 PNG 压缩默认输出 WebP；以 Canvas 实际返回的 MIME 确定扩展名，包含不支持编码器时的 PNG 回退。保存路径、引用与上传 Content-Type 跟随实际格式。
- 当前图片原地压缩保持源格式；Canvas 无法输出该格式时保留原字节，不重命名附件或改写引用。
- JPG 不支持透明度，转换时将 alpha 混合到白色背景。
- GIF 经 Canvas 只保留第一帧，不能无提示把动画处理宣传为无损。
- quality 设置为 1–100，调用 Canvas 时除以 100。
- 使用 `createEl('canvas')`，加载后释放 object URL。
- 大图受宿主内存限制，调用方必须捕获失败。

自定义引用模板未请求宽高时不得读取图片尺寸；请求尺寸但无法得到正整数时，上传仍成功，引用回退 Markdown。

## 本地图片浏览器

`ImageBrowserModal` 是本地/图床共同外壳。本地页：

- 300ms 搜索防抖。
- 名称、大小、修改时间、创建时间均支持升序和降序，并记忆本地浏览器自己的最后偏好。
- 主排序值相同时按完整 Vault 路径升序稳定排序；降序只翻转主排序方向。
- 全部/已引用/孤立引用状态筛选；扫描完成前禁用。
- 缩略图大小来自设置，双击卡片或点击预览按钮打开 `ImagePreviewModal`；按钮也支持键盘与触屏。
- green/amber/gray 分别表达已引用、孤立、无法判断。
- 切换页签或关闭后通过 generation 隔离迟到扫描结果。

选择只允许当前明确孤立的卡片，扫描未完成或状态无法判断时不可选。单击、Shift 区间、双击撤销首击、隐藏选择保留与键盘行为统一见 [共享卡片交互](settings-and-ui.md#共享卡片交互)；本地实现为 `ImageBrowserModal`，每次恢复选择仍检查实时孤立资格。少量结果按内容高度贴顶。

### 本地预览

预览显示文件名、大小、尺寸和完整引用列表：

- 引用列表默认展开，仍可收起。
- 按笔记分组并列出全部行号，展示引用总次数与笔记数；不能按 note 去重后当作引用次数。
- 点击行号关闭浏览器并定位笔记。
- 操作包括复制引用、插入当前笔记、上传、重命名和关闭。
- 本地预览只依赖窄的查询/上传/重命名 actions，不持有完整 Plugin 类型；Notice 和图床选择仍属于 Modal adapter。

复制与插入统一使用安全路径编码。

## 孤立图片与安全清理

`OrphanFinder` 使用只读 `LocalReferenceIndex` 扫描全部受支持图片、Markdown 和 Canvas 文件。它只用于“保留还是允许清理”，不是格式转换、上传替换或整理的可写引用列表。

- 识别 Markdown 内联/引用式图片或链接、Wiki 嵌入及普通 Wiki 链接（包含表格中的 `\\|` 尺寸分隔符）、HTML `src`/`href`/`srcset`、frontmatter 中的图片路径、Canvas file/text 节点，以及 Excalidraw Embedded Files 的普通 Wiki 链接。
- Markdown 目标逐段容错解码；Wiki/Canvas 目标保留宿主字面路径语义。先使用 Obsidian public `getFirstLinkpathDest()`，再在 Vault-root 和来源目录中验证明确路径。
- 结果按真实 `TFile.path` 而非仅文件名归并。短文件名有多个候选时，所有候选均为“无法判断”，没有唯一匹配时绝不猜第一个。
- 外部 scheme、protocol-relative、data 与 blob 目标不作为本地图片使用；扫描不加载图片、不执行 HTML/脚本，也不访问 Vault 外路径。
- 损坏或无法解析的 Canvas 采用 fail-closed：完整扫描中的全部图片均为 unknown，直到 Canvas 恢复可解析并重新扫描。
- 引用扫描、预览位置和每条删除前的资格复验共享这套解析语义。无法判定的文件为 gray/unknown，不可选择或自动回收；浏览器不会为持久 unknown 无限轮询全库，用户可显式重新扫描。

本地删除资格不缓存：

1. 浏览器扫描只用于展示。
2. 用户确认前重新扫描并删除已不满足条件的选择。
3. 实际执行时再次扫描。
4. 仅把仍存在且仍在 `orphans` 中的 TFile 交给 `fileManager.trashFile()`。
5. 文件消失或新增引用报告 skipped；单项回收失败报告 failed，后续继续。

专用 `OrphanImagesModal` 与图片浏览器共享上述 fresh 边界；[粘贴事务](#粘贴事务与委托接力) 中的活跃/状态未定图片同时受到保护。

## 粘贴事务与委托接力

委托自动接力在刚替换活动编辑器的事务引用后，复扫来源笔记必须使用 Editor 当前文本覆盖可能尚未刷新的 Vault 缓存；否则旧本地引用会导致错误保留本应回收的附件。

managed 自动上传保存刚插入的完整本地引用，上传后在来源 Editor 全文中按“完整引用 + Obsidian 解析到该 `TFile`”唯一重定位；Markdown linkpath 在交给 Obsidian 解析前逐段容错解码，事务身份仍保留原始编码引用。光标移动、重复引用或映射变化时失败关闭。只有精确替换成功且 fresh 全库扫描仍判定为孤立时才回收本地附件。

managed 保存前、附件落盘后及上传结果替换前均重验来源 `TFile` 仍存在，原 Editor 仍绑定该笔记；切换或关闭来源笔记时停止插入和后续自动上传，保留已落盘附件并提示。自动回收前也复验绑定，不能把复用 Editor 中另一篇笔记的文本当作来源内容。

managed 自动上传通过 `UploadService.beforeAttempt` 在每次网络尝试前重验来源绑定；读取或压缩期间来源失效时取消发送并保留本地引用与附件。已开始的上传请求不承诺取消，结果采用仍受来源重验保护。

委托接力事务在创建时冻结图床、delegated 自动上传偏好、上传压缩与质量、上传路径模板、引用模板和 delegated 本地副本策略，并保存粘贴前的来源笔记引用基线；当前引用只从基线后的新增差异中求解。在途相关设置变化使结果失效，不得继续替换或删除。managed 模式对应偏好的变化不影响 delegated 事务。

委托模式在候选附件 create 或 rename 后会延迟再次解析来源笔记，覆盖附件管理器事件先于笔记缓存更新、或用户切换笔记的事件顺序。

delegated 使用 Obsidian 链接语义解析候选时，Markdown 目标必须先按路径段解码（例如默认粘贴产生的 `%20`），Wiki 目标保持原样；事务身份仍使用原始完整引用，避免解码改变精确匹配。

delegated 接力只依据 Obsidian 公开事件、当前 Editor/Vault 内容和可解析引用作尽力协调，不接入外部附件管理者的私有生命周期，也不能证明其处理已经最终完成。外部管理者可能在上传开始后继续重命名、移动附件或改写引用；不得据此对任何特定插件、版本或配置作兼容性声明。

候选归属不使用 create FIFO。每个事务只接受其观察差异中能够与新增引用形成一一映射的 `TFile`；重叠事务、重复引用或超过输入项数量的多余候选无法唯一归属时失败关闭，已能证明的独立项可继续。同来源笔记的引用重验、替换和回收通过按笔记串行执行器完成，其他笔记仍可并行。

原来源 Editor 即使不再活动，只要仍能在 Markdown leaf 中验证绑定关系，就使用其当前内容；上传期间 Editor 内容变化时必须在最新文本中重新唯一定位并通过该 Editor 写回，不能退回 Vault 写入其背后。Editor 已关闭后才改读 Vault 保存内容，并且只有精确引用仍能唯一恢复时才继续。

上传服务在每次 delegated 网络尝试前调用事务重验；失效或验证异常后停止后续重试。网络成功后、串行写入前和本地回收前再次验证设置、附件身份及事务状态；在途成功但未采用的结果不替换引用或回收本地文件。来源笔记或附件删除会取消相应事务或图片项。多图结果按 paste/drop 事务最多汇总一次通知。

managed/delegated 设置的可见性与独立偏好见 [本地管理与图床接力](settings-and-ui.md#本地管理与图床接力)。

活跃 delegated 候选及最后一次相关 create、rename、move 或引用变化后的两秒内属于状态未定。保护按 `TFile` 独立计时并随路径更新；浏览、确认前复扫和执行前复扫都排除这些文件的孤立删除资格。

`keepLocalCopy=false` 的 delegated 自动回收会先释放该图片的活跃保护，再等待完整两秒逐图保护期；等待期间的 rename、modify、delete、设置或引用变化取消回收，保护结束后仍执行双重复扫和精确远端引用重验。

## 笔记图片上传与引用替换

`collectLocalNoteImages` 读取来源笔记的实时内容，通过共享解析器解析每处图片引用并过滤 remote；缺失和歧义保留在 resolution 中供调用方处理，多 Editor 分歧失败关闭。显式上传的扩展名筛选与源文件去重由 `createUploadPlan()` 负责，每处引用仍保留自己的 alt。

显式单图/范围上传的源快照、全库引用写回与双重复扫回收统一由 `ExplicitUploadWorkflow`、`UploadReferenceManager`、`UploadLocalCleanup` 负责，完整规则见 [上传路径与结果](hosting-and-remote.md#上传路径与结果)。范围决定选哪些笔记的图片，开启替换后可写回范围外的关联笔记。

managed 自动上传调用 `replaceVaultReferences()` 时跳过已由粘贴事务改写的来源笔记，其余笔记沿用同一批量快照写回；delegated 的精确事务引用替换继续由接力管线负责。不能用普通全库替换代替事务身份检查。

## 自动上传与本地清理

两种模式的自动上传均不受 managed 引用格式门控。以下为 managed 流程；delegated 只替换本次事务新增引用，重验规则见上方“粘贴事务与委托接力”：

1. 保存本地文件并插入引用。
2. 使用默认图床上传，传入 `savedFile.path` 支持 `{sourceDir}`。
3. 替换当前 Editor 中刚插入的引用。
4. 重验并更新其他笔记中同一图片的引用，跳过来源笔记；该路径不受显式上传的 `autoReplaceAfterUpload` 开关控制。
5. `managedKeepLocalCopy=false` 且来源绑定与 fresh 孤立检查通过时，用 `fileManager.trashFile()` 回收本地文件。
6. 桌面文件系统在回收前记录父目录（宿主回收后会清空 TFile.parent），回收后只删除确认为空、身份仍匹配的目录：所有上传线路仅检查附件的直接父目录；managed 粘贴另外检查本次保存时新建的祖先目录，按由深到浅顺序非递归清理。既有上层目录、Vault 根目录和非空目录均保留。

移动端暂存图片使用正常命名去重、本地压缩与 Markdown/Wiki 引用流程。只有远端引用已成功写回且 fresh 孤立扫描通过后才回收该文件。上传失败、来源关闭/切换、引用冲突或保留偏好变为开启时保留已落盘文件；不自动移动失败文件或在重启后自动删除。上传 `{sourceDir}` 始终取实际本地父目录，因此暂存图片使用笔记目录，显式重试也使用该实际路径。

managed 自动上传在本地未压缩而 `compressBeforeUpload=true` 时重新读取保存文件并只压缩上传载荷；本地已经按相同质量压缩时直接上传准备好的数据，避免二次有损压缩。

### 空附件目录清理

实现：[empty-folder-cleanup.ts](../../../../src/utils/empty-folder-cleanup.ts)，回归：[empty-folder-cleanup.test.ts](../../../../tests/empty-folder-cleanup.test.ts)。上传后自动清理空附件目录是现有功能，不能仅为消除 scanner 提示而移除。

- 只在桌面 `FileSystemAdapter` 上执行。候选来自刚回收图片的直接父目录；managed 额外传入本次创建的祖先目录，按深度逆序处理。
- Node `fs/promises` 仅用于 `realpath` 与非递归 `rmdir`；检查库内路径、根目录、符号链接、TFolder 身份与已索引子项。最终 `rmdir` 由系统拒绝隐藏文件或并发新增文件导致的非空目录。
- **宿主兼容限制（2026-11-07 实测）**：Obsidian 1.14.4（installer 1.13.4）在测试库新建空目录后，`adapter.rmdir(path, false)` 与 `vault.delete(folder, false)` 均报 `ERR_FS_EISDIR` 并保留目录。该证据只针对这些版本，不推断其他版本已修复或同样失败。
- 替换此实现前，必须在目标宿主证明空目录可清理、隐藏/并发新增文件保留，以及库内路径限制仍有效。先 list 再递归删除不具备同等保护；隐藏 Node 导入也没有消除直接文件系统能力。
- 移动端及其他适配器保留目录。清理失败不改变上传成功结果；自动上传中的目录策略见上一节。

## 重命名与资源整理

### 重命名

`BatchRename.renameImage` 必须在 `vault.rename()` 前更新全库引用，防止 Obsidian 内置链接更新覆盖目录信息。新引用保留原目录和格式，alt 等于旧文件名时同步更新。

显式重命名用共享来源感知解析器逐条绑定真实 `TFile`，只更新指向待重命名对象的引用；其他目录同名文件、远程 URL、缺失或歧义目标保持原文，不能仅按 basename 匹配。

显式重命名与外部引用修复读取实时 Editor/Vault 快照，写回前重验内容、路径、身份和 Editor 绑定。显式重命名记录每次引用写入；后续笔记冲突、读写失败或文件 rename 失败时，若原图片身份及路径未变，则逆序恢复仍与本次写入一致的笔记。回滚再次比较实时快照，不覆盖用户后续编辑；恢复不完整时报告受影响笔记。外部重命名修复发生在文件已经移动之后，保留已完成的有效修复。不承诺跨笔记原子性。

外部普通 rename 由 [ExternalRenameRepairCoordinator](../../../../src/lifecycle/external-rename-repair-coordinator.ts) 收敛并批量调用 `fixBrokenImageRefsBatch`；延迟与保护门禁以 `main.ts` 接线为准，不以历史逐事件等待值为依据：

- 重命名时恢复旧目录。
- 移动时使用新目录。
- `imagePathBase=note` 时重新计算相对路径。
- 整理期间 `isReorganizing=true`，跳过该修复，避免双重更新。
- 同一文件的连续 rename 保留首个旧路径和最终新路径；多文件修复在一次 Markdown Vault 扫描内完成，批次之间不重叠。
- delegated 正在观察或仍处于状态未定保护期的候选保持在队列中，门禁解除后才重新验证；批次中多个同名路径都能解释同一断链引用时不猜测目标。

### 整理

`ImageReorganizer`：

- 文件夹整理与转换/上传复用 `getNotesInScope()`；空路径和 `/` 都表示库根，首尾斜杠规范化，递归包含子目录但排除相邻前缀。根目录不能通过拼接 `//` 筛选而静默遗漏所有笔记。
- 单笔记和文件夹命令都先建立完整批次计划：按来源笔记语义绑定目标引用、对待移动 `TFile` 去重，并预绑定 Vault 中其他确实指向这些文件的引用；缺失或歧义计入 skipped，不移动、不改写。
- remote 引用由共享解析器在 Markdown 解包后识别并跳过；按 `skipWikiRefsOnReorganize` 决定本地 Wiki 是否参与。
- 同一图片在一个批次内只移动一次；目标按目标笔记遍历顺序确定。先创建目录，再基于实时占用和批次 reserved paths 重算后缀，并记录真实 `oldPath → finalPath`。
- mutation barrier 紧邻首次 rename：为待移动图片扫描的全部 Markdown（包括规划时尚未引用图片的笔记）保留快照，并与目标笔记、源图片身份一起重验；内容变化、删除或读取失败都归类为并发冲突，中止整个单笔记或文件夹批次，保证零图片移动。
- barrier 后按预绑定文件身份更新当前和其他笔记，不再按 basename 猜测。文本替换从后往前，写回返回 applied/unchanged/conflict，不能静默跳过后报告成功。
- rename 或写回失败时记录执行 journal，逆序回滚已移动图片，并仅在笔记仍等于插件刚写入内容时恢复原文；回滚不完整必须报告 partial failure。Obsidian 不提供跨文件原子事务，因此零移动保证止于 mutation barrier，barrier 后依赖受保护回滚。
- 文件夹结果把发生移动、跳过或纯引用格式转换的目标笔记都计入 processed notes；`reorganizeConvertFormat=true` 时目标为 Markdown，false 时保持原格式。

不要把“使用 Wiki 粘贴”误解为支持用户命令 Markdown → Wiki。
