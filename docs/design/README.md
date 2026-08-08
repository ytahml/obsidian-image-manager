# 设计文档

本目录用于保存新功能和现有功能调整的设计记录，使需求、决策、边界、验收标准与实施进度可以长期追踪。

## 文档原则

1. 每个功能或重大调整只保留一份设计事实来源，不在 Issue、`.agents/` 或其他工具目录复制完整正文。
2. GitHub Issue 用于讨论和跟踪，设计文档用于保存已经确认的产品与技术契约。
3. `.agents/skills/obsidian-image-manager/SKILL.md` 的 Reference Index 负责把 Agent 引导到相关设计文档。
4. `CLAUDE.md` 只作为 Claude Code 兼容入口，继续引用 `.agents` 中的 canonical skill。
5. 设计发生变化时先更新文档的决策记录，再修改实现。
6. 文档不因功能完成而删除；完成后更新状态，方向废弃时标记为已取代并链接替代方案。

## 状态

| 状态 | 含义 |
|------|------|
| 草案 | 仍在讨论，不能作为实现契约 |
| 已确认 | 产品边界和验收标准已冻结，可以开始实现 |
| 实施中 | 已有对应代码、Issue 或 PR 正在推进 |
| 已实现 | 已完成实现和验收，文档保留用于追踪 |
| 已取代 | 不再适用，必须链接新的设计文档或决策 |

## 文档索引

| 文档 | 状态 | 关联 Issue | 说明 |
|------|------|------------|------|
| [Issue #36 本地图片工作流所有权与图床接力](issue-36-local-image-workflow-ownership.md) | 已实现，待真实 Obsidian 验收 | [#36](https://github.com/ytahml/obsidian-image-manager/issues/36) | 本地管理权委托、自动图床接力、事务安全与兼容迁移已落地；仍需真实 Obsidian 环境验收。 |
| [Issue #17 图床远程对象管理](issue-17-remote-image-management.md) | 实施中 | [#17](https://github.com/ytahml/obsidian-image-manager/issues/17) | S3、七牛与阿里云 OSS 原生 Provider 均已合并到 `master`；OSS 真实环境验收与最终跨图床收尾仍待完成 |
| [本地图片浏览器与上传引用模板增强](local-image-browser-reference-template.md) | 已实现 | — | 本地引用状态筛选、安全回收站删除、默认展开完整引用列表、远程路径信息与严格引用模板契约均已通过真实 Obsidian 验收 |

## 新建设计文档模板

新文档使用小写英文和连字符命名，例如 `issue-23-feature-name.md`，至少包含：

```markdown
# 标题

> 状态：草案
> 关联 Issue：链接

## 背景
## 目标
## 非目标
## 用户流程与交互
## 功能边界
## 技术设计
## 安全、隐私与性能
## 测试矩阵
## 验收标准
## 实施阶段与进度
## 决策记录
## 关联 Issue 与 PR
## 变更记录
```

小型修复无需强制创建设计文档；涉及新功能、用户流程、数据模型、网络能力、删除行为或跨模块架构调整时应留档。
