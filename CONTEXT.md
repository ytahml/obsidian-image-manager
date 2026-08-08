# Obsidian Image Manager 领域语言

本文统一插件在本地图片、图床上传与第三方附件管理协作中的产品术语，避免把文件所有权、自动化参与和功能开关混为一谈。

## Language

**本地图片生命周期（local image lifecycle）**：
一张图片从粘贴或拖放、创建和外部整理，到图床接力、引用替换及可选本地回收的完整过程。
_Avoid_: 图片管理周期、粘贴处理、Issue #36 修复

**本地管理权（local management ownership）**：
决定由谁负责新附件的本地创建、命名、路径、内容处理以及初始引用更新；在同一粘贴事务中只能有一个所有者。
_Avoid_: 粘贴开关、路径开关、命名开关

**本地管理模式（local management mode）**：
用户对新附件本地管理权归属的选择；`managed` 归本插件，`delegated` 归 Obsidian 或其他附件管理者。
_Avoid_: 工作流开关、图床模式、off 模式

**粘贴后自动上传（automatic upload after paste）**：
独立于本地管理权的自动化选择，决定本插件是否在自己完成本地处理或外部处理达到稳定状态后执行图床接力。
_Avoid_: delegated 模式、图床总开关

**自动图床接力（automatic hosting handoff）**：
本插件在其他管理者完成本地附件处理且引用达到稳定状态后，接续执行上传和精确引用替换。
_Avoid_: 接管粘贴、兼容延迟

**通用协作（generic cooperation）**：
仅依据 Obsidian 公开事件和最终可解析状态与附件管理者协作，不依赖特定插件的 ID、内部队列或私有协议。
_Avoid_: Attachment Management 集成、插件专用适配

**生命周期协作增强（lifecycle cooperation enhancement）**：
在没有单一可复现缺陷作为前提时，减少本插件与其他附件管理者在本地图片生命周期中的职责竞争并提高兼容性。
_Avoid_: Issue #36 bug 修复、竞态修复完成

**可接力状态（handoff-ready state）**：
当前候选文件、目标引用及两者的唯一映射均可验证，足以让本插件保守尝试图床接力；它不保证附件管理者未来不再修改文件。
_Avoid_: 最终状态、稳定完成、处理完毕

**强收敛（strong convergence）**：
已经观察到候选文件移动或重命名，随后目标引用跟随更新并唯一解析到最新文件的可接力状态。
_Avoid_: 第三方处理完成、最终稳定

**弱收敛（weak convergence）**：
候选文件与初始引用已经唯一映射，但尚未观察到后续文件变化与引用跟随证据的可接力状态。
_Avoid_: 未处理、无需等待

**事务影响（transaction impact）**：
一次变更是否改变粘贴事务的候选文件、目标引用或两者的唯一映射；不以变更来自用户还是插件来区分。
_Avoid_: 用户活动、笔记安静、插件变更

**状态未定图片（indeterminate image）**：
仍处于委托事务或近期外部变更保护中的本地图片，其当前引用扫描结果不足以证明它是孤立图片。
_Avoid_: 临时孤立图片、待删除图片
