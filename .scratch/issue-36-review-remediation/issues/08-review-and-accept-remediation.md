# 08 — 完成修复后的复审与真实环境验收

**What to build:** 将本轮剩余修复作为一个完整生命周期交付重新验证，确认代码、规格、自动化竞争测试和真实 Obsidian 协作行为一致后，再决定分支是否可推送。

**Blocked by:** 04 — 按 paste/drop 事务汇总委托接力通知；05 — 落实 managed 自动上传载荷压缩；07 — 保护活跃及近期变化图片的未定状态

**Status:** completed

- [x] 自动化覆盖候选归属、来源 Editor 生命周期、同笔记串行、重试失效、事务通知、managed 压缩、rename 批处理和孤立保护的关键竞争序列。
- [x] `npm test`、`npm run build` 和 `git diff --check` 全部通过，测试辅助代码或 Vault 操作未混入产品提交。
- [x] 在真实 Obsidian 桌面环境验证 Image Manager 单独运行及与 Attachment Management 0.12.1 协作的受影响场景；1.13 声明式设置页明确不纳入本轮验收。
- [x] 以 `9fd205b...HEAD` 再做 Standards/Spec 双轴审查，不存在未处理的 P1，且对移动端、Canvas 和通用插件兼容不作超出证据的声明。
