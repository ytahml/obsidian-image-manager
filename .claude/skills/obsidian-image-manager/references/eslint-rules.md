# ESLint 规则与修复模式

## 配置

- 插件：`eslint-plugin-obsidianmd@0.3.0`
- 配置：`obsidianmd.configs.recommended`
- 内含：`typescript-eslint` 的 `recommendedTypeChecked` 规则集

## 关键规则速查

### Promise 相关

| 规则 | 要求 | 修复 |
|------|------|------|
| `@typescript-eslint/no-floating-promises` | Promise 必须被处理 | `await`、`.catch`、`.then` 或 `void` |
| `@typescript-eslint/no-misused-promises` | 回调不能返回 Promise | 改为非 async 或 `void` 包装 |
| `@typescript-eslint/require-await` | async 函数必须有 await | 移除 async 或添加 await |

### 类型安全

| 规则 | 要求 | 修复 |
|------|------|------|
| `@typescript-eslint/no-unsafe-assignment` | 禁止 any 赋值 | 添加类型断言 |
| `@typescript-eslint/no-unsafe-member-access` | 禁止 any 成员访问 | 添加类型断言 |
| `@typescript-eslint/restrict-template-expressions` | 模板字符串不能用 never | 确保类型正确 |

### Obsidian 官方规则

| 规则 | 要求 | 修复 |
|------|------|------|
| `obsidianmd/ui/sentence-case` | UI 文本 sentence case | 首字母大写，其余小写 |
| `obsidianmd/settings-tab/no-manual-html-headings` | 用 Setting API | `new Setting().setName().setHeading()` |
| `obsidianmd/no-static-styles-assignment` | 用 CSS 类 | 代替 `element.style.*` |
| `obsidianmd/no-tfile-tfolder-cast` | 用 instanceof | 代替 `as TFile` |
| `obsidianmd/prefer-file-manager-trash-file` | 用 trashFile | 代替 `vault.delete()` |
| `obsidianmd/prefer-window-timers` | 用 window.* | 代替全局 setTimeout |
| `obsidianmd/prefer-active-doc` | 用 activeDocument | 代替 document |
| `obsidianmd/editor-drop-paste` | 事件处理器守卫 | 检查 defaultPrevented + preventDefault |
| `obsidianmd/no-unsupported-api` | API 兼容性 | 不高于 minAppVersion |

### 其他

| 规则 | 要求 |
|------|------|
| `no-console` | 仅允许 `console.warn`/`error`/`debug` |

## 常见修复模式

### 1. 浮动 Promise

```typescript
// ❌
this.handleConfirm();
doUpload(config);

// ✅
void this.handleConfirm();
void doUpload(config);
```

### 2. 回调返回 Promise

```typescript
// ❌
new Modal(app, async (saved) => { await save(); });

// ✅
new Modal(app, (saved) => { void save().then(() => display()); });
```

### 3. JSON.parse 类型安全

```typescript
// ❌
this.config = JSON.parse(JSON.stringify(config));

// ✅
this.config = JSON.parse(JSON.stringify(config)) as ImageHostingConfig;
```

### 4. resp.json 类型安全

```typescript
// ❌
const json = resp.json;

// ✅
const json = resp.json as { key?: string; error?: string };
```

### 5. Array().fill() 类型安全

```typescript
// ❌
const ups: string[] = Array(count).fill('..');

// ✅
const ups: string[] = Array.from({ length: count }, () => '..');
```

### 6. Sentence case

```typescript
// ❌
'Access Key ID'
'Auto Upload On Paste'

// ✅
'Access key ID'
'Auto upload on paste'
```

**例外**：品牌名保持原样（Aliyun OSS、S3、WebP 等）

### 7. 设置标题

```typescript
// ❌
containerEl.createEl('h3', { text: '标题' });

// ✅
new Setting(containerEl).setName('标题').setHeading();
```

### 8. TFile 类型安全

```typescript
// ❌
const file = vault.getAbstractFileByPath(path) as TFile;

// ✅
const file = vault.getAbstractFileByPath(path);
if (!(file instanceof TFile)) throw new Error('Not a file');
```

### 9. window 定时器

```typescript
// ❌
setTimeout(() => {}, 100);
clearTimeout(timer);

// ✅
window.setTimeout(() => {}, 100);
window.clearTimeout(timer);
```

### 10. activeDocument

```typescript
// ❌
document.createElement('canvas');
document.addEventListener('keydown', handler);

// ✅
activeDocument.createElement('canvas');
activeDocument.addEventListener('keydown', handler);
```

### 11. editor-paste/editor-drop 处理器

```typescript
// ❌ 直接在处理器中调用 preventDefault
private handlePaste(evt: ClipboardEvent, editor: Editor, file: TFile | null) {
    evt.preventDefault(); // 不应在处理器内调用
}

// ✅ 处理器返回 boolean，由注册处调用 preventDefault
private handlePaste(evt: ClipboardEvent, editor: Editor, file: TFile | null): boolean {
    if (!imageFiles.length) return false;
    // ... 处理逻辑
    return true;
}

// 注册处：
this.registerEvent(this.app.workspace.on('editor-paste', (evt, editor, info) => {
    if (evt.defaultPrevented) return;
    const handled = this.handlePaste(evt, editor, info.file);
    if (handled) evt.preventDefault();
}));
```

## 禁止 eslint-disable

插件审核不允许使用 `eslint-disable` 绕过 `obsidianmd/*` 规则。必须修复代码以符合规则。

## 检查命令

```bash
npm run lint     # ESLint 检查
npm run build    # TypeScript 编译 + esbuild 打包
```

两项都通过后才能提交。CI（Node 20.x/22.x 矩阵）执行相同检查。
