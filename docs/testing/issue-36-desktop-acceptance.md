# Issue 36 桌面验收记录

## 环境

- 日期：2026-08-08
- Obsidian：1.13.4（installer 1.13.4），中文界面
- Vault：本地 `docs-test`
- Image Manager：当前 `codex/issue-36-local-image-lifecycle` 构建
- Attachment Management：0.12.1；设计固定源码基线为 `363c9d63a2a66867b774cfee0dac51c60d07e44e`
- 图床：本地 MinIO 配置；记录不包含凭据、响应正文或带参数 URL

## 已验证场景

| 场景 | 操作与观察 | 结果 |
|---|---|---|
| Image Manager 单独 delegated | 临时关闭 Attachment Management，粘贴一张事务图片，并在事务期间创建一张无关图片 | 事务引用替换为远端引用；事务本地文件按设置回收；无关本地文件保留；未捕获 Obsidian 错误 |
| 与 Attachment Management 协作 | 启用 0.12.1，粘贴后由其移动/重命名附件并更新引用 | Image Manager 使用最终附件路径完成接力；最终引用为远端引用；本地回收符合设置；未捕获 Obsidian 错误 |
| managed 上传压缩 | 关闭本地粘贴压缩、开启上传载荷压缩 | 本地附件保留原始数据，上传载荷走压缩路径；设置在测试后恢复 |
| 连续 rename 与未定保护 | 执行 A→B→C，并检查孤立图片界面 | 只形成一个 A→C 修复批次；保护期内不进入孤立列表，约 2.2 秒后按最新状态重新显示 |
| 同笔记多图事务 | 同一次操作粘贴两张图片 | 两个远端引用均完成，本地文件按设置回收，事务只显示一次中文汇总通知 |
| 连续三次操作 | 分轮进行连续粘贴和监听 | 事务彼此隔离，未观察到重叠写回或通知风暴 |

最终候选构建已重新安装并重载；Image Manager 与 Attachment Management 同时启用，插件成功加载，Obsidian `dev:errors` 未捕获错误。

## 测试期间的临时调整

- 测试中只临时切换 Attachment Management 启用状态、Image Manager 运行时设置和通知/批处理观察包装；均在对应轮次后恢复。
- 最新 CLI 合成 paste 不能触发 Obsidian 的真实默认粘贴处理，因此只用于加载冒烟，不计入 paste 验收；它创建的空测试笔记已移入回收站。
- 测试 Vault 中已有的测试附件和笔记不属于产品提交；源码提交未包含 Vault 配置、图床凭据或测试时包装。

## 证据边界

本记录证明上述受影响桌面场景，不等于完整兼容矩阵。以下仍未形成可复核的真实环境覆盖：移动端、Canvas、所有特殊字符组合、全部 Markdown/Wiki × paste/drop × 自动链接更新组合，以及任意其他附件插件。因此只能表述为“本地图片生命周期协作增强已通过已列场景验证”，不能宣称复现并修复 Issue 36、兼容所有插件或完成原始 Ticket 09 的全矩阵。
