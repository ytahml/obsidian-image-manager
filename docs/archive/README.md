# 文档归档登记

2026-08-09 完成知识库收敛。当前契约只保留在 `docs/design/` 和 canonical skill references 中；以下完成过程不再留在工作树全文，必要时从 Git 历史恢复。

## 已归档范围

- 远程对象管理的分阶段计划、Provider 阶段编号、进度表、决策流水和验收流水。
- 本地图片生命周期所有权的访谈树、实施阶段、派生执行规格和桌面验收记录。
- 本地图片浏览器、孤立清理和上传引用模板的独立实施设计。
- `.scratch/` 下的生命周期实施拆分与复审整改任务单。
- 旧的 `CONTEXT.md` 领域术语副本和 `docs/agents/` 元文档。

## 恢复方式

这些文件均曾被 Git 跟踪，可使用 `git log --all -- <旧路径>` 查找最后版本，再用 `git show <commit>:<旧路径>` 只读查看。归档内容是历史证据，不得覆盖当前代码、skill references 或 `docs/design/` 的现行契约。

旧路径范围：

```text
docs/design/issue-17-remote-image-management.md
docs/design/issue-36-local-image-workflow-ownership.md
docs/design/local-image-browser-reference-template.md
docs/specs/issue-36-local-image-lifecycle-handoff.md
docs/testing/issue-36-desktop-acceptance.md
.scratch/issue-36-*/issues/*.md
CONTEXT.md
docs/agents/*.md
```
