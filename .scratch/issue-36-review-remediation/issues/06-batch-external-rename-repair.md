# 06 — 批处理并串行化外部 rename 修复

**What to build:** 连续外部重命名或移动被合并为受控修复批次，先按 Obsidian 链接解析语义确认是否仍断链，再串行执行必要修复，避免重叠全 Vault 扫描和写入。

**Blocked by:** None — can start immediately

**Status:** completed

- [x] 同一图片连续 A→B→C 只按最终可验证状态处理，不为中间路径启动相互重叠的全库修复。
- [x] 多图片连续 rename 的扫描和写入保持单队列或等价串行边界，不并发执行整库处理。
- [x] 引用已能解析到最终附件时不修改；确实断链时仍保留关闭 Obsidian 自动链接更新场景下的保守修复能力。
- [x] delegated 活跃事务继续抑制普通 rename 修复，相关保护结束后才允许必要的 fallback。
