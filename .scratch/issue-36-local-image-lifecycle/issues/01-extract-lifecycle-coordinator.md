# 01 — 提取生命周期协调测试缝，保持 managed 行为不变

**What to build:** 提取一个可注入 Editor、Vault、时钟和效果执行器的本地图片生命周期协调边界，让现有 managed paste/drop 工作流从入口编排中独立出来，同时保持用户当前的命名、路径、引用、本地压缩和自动上传行为不变。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Markdown paste/drop 仍由 managed 模式接管，现有命名、路径冲突处理和引用格式行为不变。
- [ ] 本地压缩、自动上传、引用替换和可选本地回收的现有 managed 结果保持一致。
- [ ] 生命周期协调边界可注入标准化事件、时钟和效果执行器，主入口只负责注册事件和编排。
- [ ] 回归测试通过协调边界验证外部效果，不断言私有状态或实现顺序。
- [ ] 插件卸载会释放协调器持有的监听、计时器和内存状态。
- [ ] canonical 架构与本地工作流文档同步新的模块边界，但不得宣传新增 delegated 能力。
- [ ] `npm test`、`npm run build` 和 `git diff --check` 通过。
