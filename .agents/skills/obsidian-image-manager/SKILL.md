---
name: obsidian-image-manager
description: Use when developing, debugging, testing, or refactoring the md-image-manager Obsidian plugin. Also use when implementing new features, fixing bugs, adding settings, creating modals, working with uploaders, handling image compression, managing references, or reviewing code for this project.
---

# Obsidian Image Manager

Development guide for the `md-image-manager` Obsidian plugin — TypeScript, zero runtime dependencies, Obsidian Plugin API.

## Project Overview

Image management plugin for Obsidian: compression, hosting upload (4 providers), reference conversion (Wiki ↔ Markdown), image browser, orphan detection, resource reorganization, batch rename.

**Tech stack**: TypeScript 5.8.x strict, esbuild CJS bundle, Node 22 (Volta), Obsidian API types plus development-only build, lint, XML-fixture, and Vitest tooling.

**Key constraint**: Zero external runtime dependencies. Use Web Crypto API for encryption, Obsidian `requestUrl` for HTTP, and the browser `navigator.clipboard` API for clipboard writes.

## Architecture

```
main.ts (entry and orchestration)
├── settings.ts (settings tab and hosting list)
├── modals/ (local browser plus remote browser, folder, preview, and delete UI)
├── uploaders/
│   ├── uploader-factory.ts → 4 uploaders
│   ├── upload-path.ts (shared template resolution)
│   ├── oss-path.ts (Aliyun OSS URL path encoding)
│   ├── public-url.ts (public URL base normalization and joining)
│   └── upload-queue.ts (3 concurrent, 3 retries)
├── remote/
│   ├── provider/types/factory/request (provider-independent contracts)
│   ├── browse/preview/thumbnail/delete sessions and policies
│   ├── reference index and object-key matcher
│   └── providers/s3-compatible-remote.ts
├── s3/sigv4.ts (shared S3 upload/list/preview/delete signing)
├── utils/
│   ├── ref-converter.ts ← constants.ts (regex)
│   ├── public-url.ts (Markdown-safe Unicode URL display)
│   ├── image-scanner.ts
│   ├── orphan-finder.ts ← ref-converter.ts
│   ├── image-optimizer.ts (Canvas API)
│   ├── image-reorganizer.ts ← ref-converter.ts + path-utils.ts
│   ├── batch-rename.ts ← ref-converter.ts + path-utils.ts
│   └── path-utils.ts
├── types.ts (DEFAULT_SETTINGS)
└── i18n/ (zh/en, 300+ keys per locale)
```

### Design Patterns

- **Factory**: `createUploader(config)` returns uploader by `HostingType`
- **Strategy**: `ReferenceFormat` ('markdown' | 'wiki') controls reference generation
- **Observer**: `this.registerEvent()` for auto-cleanup on unload
- **Concurrent queue**: `UploadQueue` with 3 workers, 3 retries, progress callbacks

## Key Data Flows

### Paste/Drop → Save → Insert Reference

```
editor-paste/editor-drop event
  → check evt.defaultPrevented
  → handleImagePaste/handleImageDrop (returns boolean)
  → processImageFiles
      → generateFileName (template vars include {noteName})
      → optional ImageNamePromptModal
    → savePastedImage
      → resolveImagePath (template vars: {noteName}, {notePath}, {filename}, {year}, {month}, {day}, {timestamp})
      → ensureDirectory (recursive create)
      → ensureUniquePath (conflict: -1, -2, ...)
      → optional Canvas compression (PNG→WebP)
      → vault.createBinary
      → insert reference (MD or Wiki format)
      → optional autoUploadAfterPaste
```

### Direct Upload → Copy/Replace Reference

```
doUpload(file, config)
  → readBinary + optional compression
  → createUploader(config, globalTemplate).upload(data, filename, { sourcePath })
  → success: clipboard.writeText(ref)
    → Markdown URL display decodes Unicode path bytes only; reserved ASCII stays encoded
  → optional replaceReferenceInNote
    → replace local references only; never rewrite remote URL references
```

### Paste Auto-upload → Replace Reference → Optional Local Cleanup

```
autoUploadAfterPaste(savedFile, data, editor, currentFile)
  → createUploader(config, globalTemplate).upload(data, filename, { sourcePath })
  → replace the newly inserted local reference in the active editor
  → replace matching local references in other notes; skip the active note already changed in memory
  → optional trashFile (!keepLocalCopy)
  → permanently remove the exact direct attachment folder when it is still empty
```

### Reorganize → Move + Update References

```
reorganizeNote(file)
  → ImageReorganizer.reorganizeNote
    → parseReferences (all references)
    → reverse traversal per reference:
      → skip: external URL, Wiki refs (configurable)
      → resolveImageFromRef → resolveImagePath
      → vault.rename (move file)
      → update reference format
    → vault.process (update note content)
    → updateOtherNotes (update other notes)
```

## Settings Gating

Critical: `reorganizeConvertFormat` controls image hosting availability.

```
reorganizeConvertFormat
  ├── true (default) → hosting features enabled
  │   ├── hosting settings panel renders
  │   ├── upload commands work
  │   └── paste uses MD format
  └── false → hosting features disabled
      ├── hosting panel shows notice
      ├── upload commands show Notice
      └── paste uses Wiki format
```

Other key settings:
- `promptImageName`: show name prompt on paste/drop
- `autoUploadOnPaste`: auto upload after paste (requires `reorganizeConvertFormat=true`)
- `autoReplaceAfterUpload`: replace reference after upload
- `keepLocalCopy`: keep local file after upload; when false, auto-upload removes the exact direct attachment folder only if it is still empty
- `skipWikiRefsOnReorganize`: skip Wiki refs during reorganize
- `uploadPathTemplate`: global upload path fallback; supports `{sourceDir}` for the Vault-relative parent directory
- `urlPrefix`: public access URL base for Aliyun OSS, Qiniu, and S3; may include a bucket or directory path

## Coding Conventions

### Test, Build & Lint

```bash
npm run dev      # watch mode
npm test         # Vitest unit tests
npm run build    # tsc check + esbuild minify
npm run lint     # eslint-plugin-obsidianmd@0.3.0
```

`npm test` and `npm run build` must pass before commit. The build script includes lint, TypeScript checks, and the production bundle. CI runs on Node 22.x.

### Critical ESLint Rules

| Rule | Fix |
|------|-----|
| `no-floating-promises` | `await`, `.catch`, `.then`, or `void` |
| `no-misused-promises` | Non-async callback or `void` wrap |
| `sentence-case` | First letter uppercase, rest lowercase |
| `no-manual-html-headings` | `new Setting().setName().setHeading()` |
| `no-static-styles-assignment` | CSS classes instead of `element.style.*` |
| `no-tfile-tfolder-cast` | `instanceof TFile` instead of `as TFile` |
| `prefer-file-manager-trash-file` | `fileManager.trashFile()` instead of `vault.delete()` |
| `prefer-window-timers` | `window.setTimeout` instead of `setTimeout` |
| `prefer-active-doc` | `activeDocument` instead of `document` |
| `editor-drop-paste` | Check `defaultPrevented` + return boolean |
| `no-unsupported-api` | Not higher than `minAppVersion` |
| `no-console` | Only `console.warn`/`error`/`debug` |

### Common Fix Patterns

```typescript
// Floating promise
void this.handleConfirm();

// Callback returning Promise
new Modal(app, (saved) => { void save().then(() => display()); });

// JSON.parse type safety
this.config = JSON.parse(JSON.stringify(config)) as ImageHostingConfig;

// Array fill type safety
const ups: string[] = Array.from({ length: count }, () => '..');

// Sentence case
'Access key ID'  // ✅  'Access Key ID'  // ❌

// Setting heading
new Setting(containerEl).setName('标题').setHeading();

// TFile type safety
const file = vault.getAbstractFileByPath(path);
if (!(file instanceof TFile)) throw new Error('Not a file');

// Window timers + activeDocument (popout compat)
window.setTimeout(() => {}, 100);
activeDocument.createElement('canvas');

// editor-paste/editor-drop handler
private handlePaste(evt: ClipboardEvent, editor: Editor, file: TFile | null): boolean {
    if (!imageFiles.length) return false;
    // ... process
    return true;
}
// Registration:
this.registerEvent(this.app.workspace.on('editor-paste', (evt, editor, info) => {
    if (evt.defaultPrevented) return;
    const handled = this.handlePaste(evt, editor, info.file);
    if (handled) evt.preventDefault();
}));
```

**No `eslint-disable` for `obsidianmd/*` rules** — plugin review rejects it.

## Known Issues (Fixed)

Reference: [known-issues.md](references/known-issues.md)

Key fixes to avoid repeating:
1. **IME enter** (1.0.1): Add `if (e.isComposing) return;` in keydown handlers
2. **Rename losing path** (1.0.5): `vault rename` event + `fixBrokenImageRefs` with 100ms delay
3. **Reference count** (1.0.7): Count all references, not just unique notes
4. **Absolute path in reorganize** (1.0.8): Use relative path based on `imagePathBase`
5. **"Always update internal links" conflict** (1.0.8): `isReorganizing` flag to skip `fixBrokenImageRefs`

## Development Workflow

### New Feature

1. Create issue on GitHub
2. Create branch: `feat/issue-N`
3. Implement following coding conventions
4. Commit: `feat: description Closes #N`
5. Merge to master
6. Release: `npm version patch/minor/major`

### Bug Fix

1. Create branch: `fix/issue-N`
2. Fix with test verification
3. Commit: `fix: description Closes #N`
4. Merge to master
5. Release: `npm version patch`

### Adding New Hosting Provider

1. Extend `UploaderBase`, implement `upload()` + `testConnection()`
2. Register in `uploader-factory.ts`
3. Add config fields in `hosting-config.ts`
4. Add translations in `i18n/en.ts` and `i18n/zh.ts`

### Adding New Modal

1. Extend Obsidian `Modal`
2. Reference existing modals in `src/modals/`
3. Add IME compatibility (`if (e.isComposing) return;`)

### Adding New Setting

1. Add to `ImageManagerSettings` + `DEFAULT_SETTINGS` in `types.ts`
2. Render UI in `settings.ts`
3. Add translations in `i18n/en.ts` and `i18n/zh.ts`

## Reference Index

Detailed documentation for each module:

| Module | File | Use When |
|--------|------|----------|
| Architecture | [architecture.md](references/architecture.md) | Understanding project overview, designing new features |
| Core types | [core-types.md](references/core-types.md) | Adding settings, modifying types |
| Uploaders | [uploaders.md](references/uploaders.md) | Adding hosting provider, modifying upload logic |
| Ref converter | [ref-converter.md](references/ref-converter.md) | Modifying reference format, adding reference type |
| Paste/drop | [paste-drop.md](references/paste-drop.md) | Modifying naming template, compression behavior |
| Image optimizer | [image-optimizer.md](references/image-optimizer.md) | Optimizing compression, adding format support |
| Image scanner | [image-scanner.md](references/image-scanner.md) | Modifying filter logic, optimizing scan performance |
| Image reorganizer | [image-reorganizer.md](references/image-reorganizer.md) | Modifying reorganize strategy, adding reorganize mode |
| Batch rename | [batch-rename.md](references/batch-rename.md) | Optimizing rename logic, fixing reference updates |
| Modals | [modals.md](references/modals.md) | Adding modal, modifying UI interaction |
| Settings | [settings.md](references/settings.md) | Adding setting item, modifying settings UI |
| i18n | [i18n.md](references/i18n.md) | Adding translations, modifying copy |
| ESLint rules | [eslint-rules.md](references/eslint-rules.md) | Fixing lint errors, code review |
| CI/CD | [ci-cd.md](references/ci-cd.md) | Modifying release flow, troubleshooting CI |
| Known issues | [known-issues.md](references/known-issues.md) | Troubleshooting similar bugs, avoiding repeated pitfalls |
| Design documentation | [docs/design/README.md](../../../docs/design/README.md) | Creating or updating feature designs and tracking architectural decisions |
| Issue #17 remote management plan | [issue-17-remote-image-management.md](../../../docs/design/issue-17-remote-image-management.md) | Planning or implementing remote image hosting browsing, reference status, preview, or deletion |

## Pending Features

- **Image hosting migration**: Command registered (`migrate-images`), types defined, shows "not implemented"
- **Restore local refs**: Translation keys exist, no implementation code
- **Remote image hosting management (Issue #17)**: The S3-first track G0–G5 and S3-1 through S3-5 is complete. Issue #26 closed through PR #27 after Cloudflare R2 and MinIO list, virtual-folder, public/private preview, viewport-thumbnail, reference-location, and delete acceptance. The current UI is a responsive card grid: scans remain explicit, visible thumbnails use a 4-concurrency queue, cards append locally in batches of 60, and search/sort/reference filters cover the complete scanned set without page controls. The S3 folder picker uses paged `ListObjectsV2(prefix, delimiter='/')` / `CommonPrefixes`, while manual prefix input remains available. Deletion follows remote-management `enabled` and retains fresh Markdown gates, exact-count plus acknowledgement confirmation, 20-item/2-concurrency scheduling, and a 200-entry redacted audit. Do not regress to the historical metadata table, remote page controls, manual-only thumbnails, standard-image-syntax-only reference detection, or a separate delete toggle. Remaining Issue #17 work is G6 upload-manifest support, non-S3 providers, and global cross-provider/release closure. The phased plan is maintained in [docs/design/issue-17-remote-image-management.md](../../../docs/design/issue-17-remote-image-management.md)
