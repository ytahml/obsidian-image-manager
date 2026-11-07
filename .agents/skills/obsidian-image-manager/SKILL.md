---
name: obsidian-image-manager
description: Use when developing, debugging, testing, reviewing, refactoring, or documenting the md-image-manager Obsidian plugin.
---

# Obsidian Image Manager

Canonical development guide for `md-image-manager`, the Markdown Image Manager Obsidian plugin. Working agreements live in [AGENTS.md](../../../AGENTS.md); this skill owns implementation guidance.

## Required Workflow

1. Inspect `git status`, the current branch, and the task-relevant source before deciding what to change. Follow AGENTS.md for branch and publication boundaries.
2. Route through the Reference Index. Read the relevant sections and their callers/tests; load additional sections only when the affected behavior crosses their boundary. The business rules below apply to every task.
3. Verify implementation facts against current source and configuration. These references and current design contracts preserve intended behavior; resolve discrepancies instead of silently weakening a contract. Tickets, archived plans, and Git history are supporting evidence.
4. Keep `src/main.ts` focused on lifecycle, commands, events, and orchestration. Put reusable behavior and protocol logic in focused modules.
5. Update the owning reference when its behavior or guidance changes. Link to source for defaults, command lists, and tool versions rather than copying them into more documents.
6. Complete the [validation appropriate to the change](references/development.md#验证选择), including documentation checks for skill-only edits. Report automated checks, real Obsidian/provider acceptance, and publication separately.

## Non-Negotiable Business Rules

- `managedPasteReferenceFormat` only selects managed paste output, and `reorganizeConvertFormat` only controls explicit reorganization conversion. Neither gates hosting commands or automatic upload.
- Remote listing never starts on browser open. The user must explicitly scan; search, sort, and reference filters operate on the complete scanned in-memory set.
- Provider cursors are opaque. Shared code must not parse, decode, re-encode, or synthesize them.
- Any reliably mapped remote URL in supported Markdown content counts as `referenced`, regardless of whether it appears as an image, link, HTML, frontmatter, Wiki wrapper, or raw URL.
- Only a completed fresh Markdown index may return `not-referenced-in-current-vault`. Empty, stale, aborted, ambiguous, or unmappable states must never enable deletion.
- Remote deletion requires matching hosting, prefix, scan snapshot, exact-count confirmation and acknowledgement; selection count is uncapped, requests remain limited to two concurrent operations, and there is no automatic retry.
- Local orphan cleanup rescans before confirmation and again at execution, then uses `fileManager.trashFile()` only for files that remain orphaned. Upload-time empty-folder cleanup is a separate [nonrecursive operation](references/local-image-workflows.md#空附件目录清理).
- Upload success may invalidate an open matching remote session, but neither upload results nor delete history prove current remote existence.
- Custom reference templates require `{fileUrl}`. Unknown variables or unavailable requested dimensions safely fall back to Markdown.
- Do not expose provider response bodies, signed query values, credentials, or presigned URLs in errors, audit records, or UI.

## Tooling Constraints

- Use npm and the repository's scripts, compiler settings, and Obsidian ESLint rules; see [development.md](references/development.md). The plugin has no bundled runtime dependencies.
- Use Obsidian `requestUrl`, Web Crypto, and public host APIs. Production file operations stay within the Vault; the existing desktop Node helper is limited to the documented empty-folder cleanup, not a general filesystem escape hatch.
- Do not add runtime dependencies, telemetry, hidden network calls, remote code execution, or out-of-vault operations. Never suppress `obsidianmd/*` rules with `eslint-disable`.

## Reference Index

| Topic | Read when |
| --- | --- |
| [architecture.md](references/architecture.md) | Orienting in the repository, changing commands, types, lifecycle, module boundaries, or feature scope |
| [local-image-workflows.md](references/local-image-workflows.md) | Paste/drop, paths, local references/compression, orphan cleanup, rename/reorganization, or desktop filesystem warnings |
| [hosting-and-remote.md](references/hosting-and-remote.md) | Upload orchestration, provider signing, URL prefix migration, remote scan/preview/reference/delete, or provider capabilities |
| [settings-and-ui.md](references/settings-and-ui.md) | Settings/default migration, hosting configuration, modals, shared card gestures, CSS, i18n, or mobile layouts |
| [development.md](references/development.md) | Selecting checks, lint/build/scanner failures, release preparation, or maintaining project guidance |
| [docs/design/README.md](../../../docs/design/README.md) | Creating or retiring a durable product decision; completed designs are archived and not part of the default task route |
