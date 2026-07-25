---
name: obsidian-image-manager
description: Use when developing, debugging, testing, reviewing, refactoring, or documenting the md-image-manager Obsidian plugin.
---

# Obsidian Image Manager

Canonical development guide for `md-image-manager`, a TypeScript Obsidian community plugin with no bundled runtime dependencies.

## Required Workflow

1. Inspect `git status`, the current branch, and the task-relevant source before deciding what to change.
2. Read the task-relevant reference from the index below. For cross-cutting work, read every affected reference.
3. Treat current code and the linked design documents as product truth; historical examples in Git or issues are evidence, not an active contract.
4. Keep `src/main.ts` focused on lifecycle, commands, events, and orchestration. Put reusable behavior and protocol logic in focused modules.
5. After changing behavior, architecture, settings, UI workflows, provider support, tests, or release workflows, update the relevant reference.
6. Before committing, run `npm test`, `npm run build`, and `git diff --check`.

## Product at a Glance

- **Local files**: paste/drop saving, naming/path templates, Canvas compression, reference-aware gallery, preview, safe orphan cleanup, rename, and template-based reorganization.
- **References**: Markdown and Wiki image parsing; user commands convert Wiki images to Markdown. Generated Markdown paths keep Unicode readable and encode syntax-sensitive ASCII.
- **Uploads**: Aliyun OSS, Qiniu, S3-compatible storage, and Custom HTTP. `UploadService` owns direct, note, vault batch, and paste-auto-upload orchestration.
- **Remote objects**: Aliyun OSS, Qiniu Kodo, and S3-compatible providers support explicit scan, virtual folders, card browsing, viewport thumbnails, preview, reference locations, and guarded deletion. Custom HTTP remains upload-only.
- **Settings and UI**: Chinese/English, Obsidian 1.12.0 minimum, mobile-compatible where the host APIs permit.

## Non-Negotiable Business Rules

- `reorganizeConvertFormat` is the Markdown/hosting gate. When false, paste uses Wiki references and hosting UI/commands are unavailable.
- Remote listing never starts on browser open. The user must explicitly scan; search, sort, and reference filters operate on the complete scanned in-memory set.
- Provider cursors are opaque. Shared code must not parse, decode, re-encode, or synthesize them.
- Any reliably mapped remote URL in supported Markdown content counts as `referenced`, regardless of whether it appears as an image, link, HTML, frontmatter, Wiki wrapper, or raw URL.
- Only a completed fresh Markdown index may return `not-referenced-in-current-vault`. Empty, stale, aborted, ambiguous, or unmappable states must never enable deletion.
- Remote deletion requires matching hosting, prefix, scan snapshot, exact-count confirmation and acknowledgement; limit 20 objects, two concurrent requests, no automatic retry.
- Local orphan cleanup rescans before confirmation and again at execution, then uses `fileManager.trashFile()` only for files that remain orphaned.
- Upload success may invalidate an open matching remote session, but neither upload results nor delete history prove current remote existence.
- Custom reference templates require `{fileUrl}`. Unknown variables or unavailable requested dimensions safely fall back to Markdown.
- Do not expose provider response bodies, signed query values, credentials, or presigned URLs in errors, audit records, or UI.

## Known Code Boundaries

- `migrate-images` is a stable registered command that currently shows a not-implemented notice; migration types exist but there is no migration engine or history UI.
- Restore-local-reference translation keys exist, but there is no registered command or implementation.
- Custom HTTP hosting has no common object protocol and must not be given generic list/preview/delete behavior by guessing from its returned URL.
- `RemoteManagementConfig.pageSize` and `previewMode` remain only for old `data.json` compatibility; current UI has no result pagination and normalizes previews to viewport loading.

## Tooling Constraints

- Use npm, TypeScript 5.8 strict checking, esbuild, Vitest, and `eslint-plugin-obsidianmd`.
- TypeScript libraries include DOM and ES2017. Avoid later APIs such as `flatMap` or `matchAll` unless the target is intentionally upgraded.
- Use Obsidian `requestUrl`, Web Crypto, DOM helpers, active-document APIs, window timers, and `instanceof TFile/TFolder`.
- Do not add runtime dependencies, telemetry, hidden network calls, remote code execution, or out-of-vault file access.
- Never suppress `obsidianmd/*` rules with `eslint-disable`.

## Reference Index

| Topic | Read when |
|---|---|
| [architecture.md](references/architecture.md) | Orienting in the repository, changing commands, types, lifecycle, module boundaries, or feature scope |
| [local-image-workflows.md](references/local-image-workflows.md) | Changing paste/drop, paths, references, compression, local browser, orphan cleanup, rename, or reorganization |
| [hosting-and-remote.md](references/hosting-and-remote.md) | Changing upload orchestration, provider signing, remote scan/preview/reference/delete behavior, or provider capabilities |
| [settings-and-ui.md](references/settings-and-ui.md) | Changing defaults, settings, hosting configuration, modals, CSS, i18n, or mobile behavior |
| [development.md](references/development.md) | Adding features/providers, fixing lint/test/build issues, releasing, troubleshooting, or updating documentation |
| [docs/design/README.md](../../../docs/design/README.md) | Creating or locating durable product/design decisions |
| [local-image-browser-reference-template.md](../../../docs/design/local-image-browser-reference-template.md) | Changing local reference states, orphan deletion, preview references, remote path display, or custom reference templates |
| [issue-17-remote-image-management.md](../../../docs/design/issue-17-remote-image-management.md) | Changing remote object-management product or safety contracts |
