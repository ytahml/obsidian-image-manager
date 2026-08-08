# 02 — 交付本地管理权选择与完整退出路径

**What to build:** 让用户选择 `managed` 或 `delegated` 本地管理模式；当选择 `delegated` 且关闭自动上传时，Image Manager 完全不接管或跟踪 Markdown paste/drop，同时保留手动上传、浏览器和远程管理能力。

**Blocked by:** 01 — 提取生命周期协调测试缝，保持 managed 行为不变。

**Status:** ready-for-agent

- [ ] 新旧安装均默认 `managed`，不存在持久化 `off` 值。
- [ ] `delegated + autoUploadOnPaste=false` 不调用 paste/drop 默认行为阻止、不建立事务、不收集候选文件且不启动收敛计时器。
- [ ] managed 粘贴引用格式与显式整理转换拆分，图床能力不再由两者门控。
- [ ] 旧自动上传按旧有效门控和能否解析启用图床迁移；迁移不联网验密，也不会意外开启网络上传。
- [ ] 设置页将本地附件管理与图床接力分组；delegated 禁用并解释 managed 专属设置，同时保留原值。
- [ ] 没有可解析启用图床时不能开启自动上传；手动上传、图片浏览和远程管理仍可用。
- [ ] Obsidian 1.13 声明式设置与 1.12 fallback 的顺序、门控、保存副作用和中英文文案一致。
- [ ] managed 回归、迁移组合、delegated 完整退出和设置 UI 测试通过。
- [ ] canonical 设置、架构、本地工作流和领域语言文档同步。
- [ ] `npm test`、`npm run build` 和 `git diff --check` 通过。
