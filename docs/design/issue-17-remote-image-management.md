# 远程对象管理

> 状态：归档
>
> 本设计对应的实现已完成。当前实现事实以 `.agents/skills/obsidian-image-manager/references/` 为准；除非修改远程对象管理产品边界，否则不需要读取本文。

本文定义远程图床对象的显式扫描、浏览、预览、引用判断和受保护删除契约。远端事实只来自当前 Provider 扫描。

## Provider 能力

| 类型 | 上传 | 列举/目录 | 预览 | 删除 |
|---|---:|---:|---:|---:|
| Aliyun OSS | 是 | 是 | 是 | 是 |
| Qiniu Kodo | 是 | 是 | 是 | 是 |
| S3-compatible | 是 | 是 | 是 | 是 |
| Custom HTTP | 是 | 否 | 否 | 否 |

上传由 `UploaderBase` 与 `UploadService` 编排；远程管理由独立 `RemoteObjectProvider` capability 表达。Custom HTTP 没有稳定对象协议，不从返回 URL 猜测 object key、列举、预览或删除能力。

## 扫描与范围

- 打开浏览器、切换图床或打开目录选择器都不自动扫描；用户必须明确触发。
- `prefix` 去除首尾 `/`。空前缀合法并表示当前 bucket 根，但每个会话首次扫描前必须确认请求、流量和范围风险。
- Provider 单次 `limit` 最大 1000；浏览会话每批最多连续 10 次 list 请求，然后等待用户继续。
- cursor 是 Provider 的不透明值；共享代码只原样透传。`truncated=true` 且没有可用 cursor 是协议错误。
- 搜索、排序和引用筛选作用于已经完整扫描的内存集合；卡片首批 60 项，滚动时每批追加 60。
- 图床、prefix、refresh、stop 或 close 通过 generation 使迟到结果失效；当前接口不承诺取消已发出的 HTTP。
- 虚拟目录列举与递归对象扫描是不同请求。Provider 返回越出当前层级或 scope 的 prefix 必须拒绝。

## 预览与流量

- 图片接近 viewport 约 200px 才解析预览 URL；最多 4 个 URL 解析并发。
- 缩略图和大图共享进行中的 URL 请求及仍有效缓存；只有实际设置 `<img src>` 才计入图片请求数。
- 私有临时 URL 有效期 300 秒，接近安全窗口时重签；公开模式只使用明确配置的公共 URL，不猜 ACL 或回退 endpoint。
- OSS 冷存储对象不自动预览；Qiniu 公共和私有预览都依赖下载域名；S3-compatible 私有预览使用 SigV4 presigned GET。
- UI 必须说明 viewport 缩略图和原图预览可能产生读取、下载流量和服务商费用。

## 引用索引

索引按需扫描 Markdown 文件；相关文件 create、modify、delete 或 rename 后变 stale，不后台自动重扫。

- 可可靠映射的 Markdown 图片、普通链接、HTML、frontmatter、Wiki 包裹和裸 URL 都归为 `referenced`。
- `possibly-referenced` 仅为旧类型兼容；当前可靠映射统一归入 `referenced`。
- 主公共 URL、源站 base 和合法 `publicUrlAliases` 共同参与映射；不按 basename 猜测，也不把相邻 path prefix 当命中。
- encoded slash、double-encoded percent 和 query 语义必须保持可区分；query value 不进入索引、错误或审计。
- 只有完整完成的 fresh 索引可以产生 `not-referenced-in-current-vault`。empty、stale、abort、歧义或无法映射都不能启用删除。

“当前 Vault 未检测到引用”不等于“安全删除”；外部网站、其他 Vault 和应用仍可能引用对象。

## 删除门禁

对象只有同时满足以下条件才能选择：远程管理启用、Provider 有 delete capability、索引 fresh、hosting 匹配、key 在 prefix 边界内、对象属于当前 scan snapshot，且状态为 `not-referenced-in-current-vault`。

- 每批最多 20 项、最多 2 个请求并发、不自动重试。
- 确认要求输入精确数量并勾选不可撤销确认；IME composing 时 Enter 不提交。
- batch 创建后冻结配置、prefix、scan 和 index 身份；执行前验证漂移。
- 只发送 exact-key 单对象删除，不使用批量 DeleteObjects，不附加 versionId、MFA 或 Object Lock 绕过参数。
- stop 后不调度未发送项，但保留 in-flight 结果。
- 200/204 只表示请求被服务端接受。S3/OSS 最多区分 `delete-marker` 与 `unknown`，不得声称永久释放空间。
- 删除请求接受后失效列表、预览和选择；必须重新扫描才能确认当前远端状态。

## 隐私、审计与验收

- Provider 错误只暴露稳定分类、必要 HTTP status、retryable 和去除账号/query/fragment 的 endpoint。
- 响应正文、headers、凭据、签名 query 和 presigned URL 不进入 UI、日志或审计。
- 删除审计最多保存 200 条完成结果，只用于诊断，不参与对象存在、引用或删除资格判断。
- Provider 变更必须验证特殊字符 key、canonical request、opaque cursor、目录边界、公开/私有预览、fresh/stale/abort、删除限制、部分失败和迟到响应。
- 自动化不能替代真实服务商验收；只对实际验证过的 Provider、访问模式和删除范围作兼容声明。
