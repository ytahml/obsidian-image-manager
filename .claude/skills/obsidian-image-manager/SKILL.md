---
name: obsidian-image-manager
description: Use when developing, debugging, testing, or refactoring the md-image-manager Obsidian plugin. Also use when implementing new features, fixing bugs, adding settings, creating modals, working with uploaders, handling image compression, managing references, or reviewing code for this project.
---

# Obsidian Image Manager

Development guide for the `md-image-manager` Obsidian plugin — TypeScript, zero runtime dependencies, Obsidian Plugin API.

## Project Overview

Image management plugin for Obsidian: compression, hosting upload (4 providers), reference conversion (Wiki ↔ Markdown), image browser, orphan detection, resource reorganization, batch rename.

**Tech stack**: TypeScript 5.8.x strict, esbuild CJS bundle, Node 22 (Volta), `obsidian` as only devDependency.

**Key constraint**: Zero external runtime dependencies. Use Web Crypto API for encryption, Obsidian `requestUrl` for HTTP, `require('electron')` for clipboard.

## Architecture

```
main.ts (entry, ~995 lines)
├── settings.ts (6 render methods)
├── modals/ (7 Modal components)
├── uploaders/
│   ├── uploader-factory.ts → 4 uploaders
│   └── upload-queue.ts (3 concurrent, 3 retries)
├── utils/
│   ├── ref-converter.ts ← constants.ts (regex)
│   ├── image-scanner.ts
│   ├── orphan-finder.ts ← ref-converter.ts
│   ├── image-optimizer.ts (Canvas API)
│   ├── image-reorganizer.ts ← ref-converter.ts + path-utils.ts
│   ├── batch-rename.ts ← ref-converter.ts
│   └── path-utils.ts
├── types.ts (DEFAULT_SETTINGS)
└── i18n/ (zh/en, ~180 keys)
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

### Upload → Replace Reference

```
doUpload(file, config)
  → readBinary + optional compression
  → createUploader(config).upload(data, filename)
  → success: clipboard.writeText(ref)
  → optional replaceReferenceInNote
  → optional trashFile (!keepLocalCopy)
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
- `keepLocalCopy`: keep local file after upload
- `skipWikiRefsOnReorganize`: skip Wiki refs during reorganize

## Coding Conventions

### Build & Lint

```bash
npm run dev      # watch mode
npm run build    # tsc check + esbuild minify
npm run lint     # eslint-plugin-obsidianmd@0.3.0
```

Both must pass before commit. CI runs Node 20.x/22.x matrix.

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

## Pending Features

- **Image hosting migration**: Command registered (`migrate-images`), types defined, shows "not implemented"
- **Restore local refs**: Translation keys exist, no implementation code
