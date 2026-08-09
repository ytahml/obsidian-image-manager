# Project agent bootstrap

禁止执行可能造成数据丢失或系统损坏的操作。涉及不可恢复或大范围删除时，先解析精确目标、说明影响并取得明确授权；优先使用 Git、系统回收站等可恢复方式。

Before analyzing, changing, testing, or reviewing this project, read `.agents/skills/obsidian-image-manager/SKILL.md` completely and follow its Required Workflow.

`CLAUDE.md` is only a compatibility entrypoint to the same canonical skill.

## Working agreements

- Report implementation, automated validation, real Obsidian/provider acceptance, merge, and release as separate evidence states. Diagnose user-visible behavior through the production call path.
- Keep durable project conventions in this file, current implementation knowledge in the canonical skill references, and cross-module product decisions in `docs/design/`. Use these project documents as the project memory source.
- For independent work, update the default branch and create a dedicated branch named by change type and functional scope, such as `feat/remote-preview`, `fix/paste-path`, or `docs/agent-guidance`. Continue follow-up work for the same task on its current branch.
- Write GitHub Issue and PR titles and bodies in Chinese unless the audience requires another language. Keep Issues self-contained, and add hierarchy or blocking relationships only when requested.
- Choose regular merge for meaningful staged histories and squash merge for small cleanup histories; merge only with explicit authorization.
