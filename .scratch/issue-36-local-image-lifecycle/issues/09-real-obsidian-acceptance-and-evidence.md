# 09 — 完成真实 Obsidian 兼容验收与证据收尾

**What to build:** 在真实 Obsidian 桌面环境中验证完整本地图片生命周期，分别证明 Image Manager 单独运行和与 Attachment Management 0.12.1 同时运行时符合已确认契约，并以准确证据更新实施状态与用户文档。

**Blocked by:** 08 — 完成跨切片自动化集成验证。

**Status:** ready-for-agent

- [ ] 固定 Attachment Management 0.12.1、提交 `363c9d63a2a66867b774cfee0dac51c60d07e44e` 作为外部验收基线。
- [ ] 分别验证 Image Manager 单独运行、Attachment Management 单独运行和两者同时运行。
- [ ] 覆盖 managed/delegated、自动上传开关、Obsidian 内部链接自动更新开关、Markdown/Wiki 和 paste/drop。
- [ ] 覆盖单图/多图、同一行多图、重复文件名、相同字节、中文、空格、`#`、`%`、括号和编码路径。
- [ ] 覆盖附件初始 move/rename、笔记重命名触发的重新整理、用户持续编辑、编辑器切换/关闭和插件卸载。
- [ ] 覆盖上传成功、失败、超时、在途变化、`keepLocalCopy` 开关以及外部变化期间和刚结束后的孤立扫描。
- [ ] 验证 delegated 不修改本地附件内容，不错误替换事务外引用，也不误删共享或状态未定文件。
- [ ] 验证每个事务最多一次安全汇总，并记录远端未采用对象的保守提示。
- [ ] 没有真实移动端环境时明确标记移动端未验证；Canvas 自动接力继续标记不在范围。
- [ ] 记录真实环境、版本、步骤、结果和未覆盖项；不能把单元测试写成真实兼容验收。
- [ ] `npm test`、`npm run build` 和 `git diff --check` 再次通过。
- [ ] 更新 canonical 设计、技能文档和用户文档，仅对实际验证的行为标记已实现。
- [ ] 对外表述使用“生命周期协作增强”，不宣称已复现 bug、彻底解决竞态或兼容所有附件插件。
