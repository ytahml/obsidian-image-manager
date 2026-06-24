# CI/CD 与版本发布

## CI 工作流

### Lint & Build（`.github/workflows/lint.yml`）

```yaml
触发条件：push/PR 到 master
Node 版本：20.x / 22.x（矩阵）
执行步骤：
  - npm ci
  - npm run build
  - npm run lint
```

### Release（`.github/workflows/release.yml`）

```yaml
触发条件：推送 tag（如 1.0.0，无 v 前缀）
执行步骤：
  - npm ci
  - npm run build
  - 打包 zip：main.js + manifest.json + styles.css
  - softprops/action-gh-release@v2 创建 GitHub Release
上传产物：
  - main.js
  - manifest.json
  - styles.css
  - md-image-manager.zip
```

## 版本发布流程

### 使用 npm version

```bash
npm version patch   # 1.0.7 → 1.0.8（修复）
npm version minor   # 1.0.7 → 1.1.0（新功能）
npm version major   # 1.0.7 → 2.0.0（破坏性变更）
```

### 生命周期钩子

| 阶段 | 脚本 | 动作 |
|------|------|------|
| `preversion` | `npm run build` | 构建检查（lint + tsc + esbuild），失败则中止 |
| `version` | `version-bump.mjs` | 更新 manifest.json + versions.json |
| `version` | `git add` | 暂存 4 个文件 |
| npm 自动 | — | 修改 package.json，创建 commit + tag |
| `postversion` | `git push` | 推送 commit 和 tag 到 origin master |

### version-bump.mjs 逻辑

1. 从 `manifest.json` 读取 `minAppVersion`
2. 将 `manifest.json` 的 `version` 更新为目标版本
3. 在 `versions.json` **开头**插入新版本条目（新版本置顶）
4. 若目标版本已存在则跳过

### 暂存的文件

- `manifest.json`
- `versions.json`
- `package.json`
- `package-lock.json`

## 手动发布步骤

如果需要手动发布：

```bash
# 1. 构建检查
npm run build

# 2. 更新版本号
# 手动修改 package.json、manifest.json、versions.json

# 3. 提交
git add manifest.json versions.json package.json package-lock.json
git commit -m "v1.0.8"

# 4. 打 tag
git tag 1.0.8

# 5. 推送
git push origin master --tags
```

## 产物说明

| 文件 | 用途 |
|------|------|
| `main.js` | esbuild 打包的 CJS 代码（构建产物，不要手动编辑） |
| `manifest.json` | 插件元数据（ID、版本、minAppVersion 等） |
| `styles.css` | 插件样式 |
| `md-image-manager.zip` | 上述 3 个文件的打包 |

## manifest.json 关键字段

```json
{
    "id": "md-image-manager",
    "name": "Markdown Image Manager",
    "version": "1.0.7",
    "minAppVersion": "1.12.0",
    "description": "Image management plugin...",
    "author": "imulan",
    "isDesktopOnly": false
}
```

**注意**：
- `id` 发布后不可更改
- `minAppVersion` 使用新 API 时需同步更新
- tag 必须与 `manifest.json` 的 `version` 完全匹配（无 `v` 前缀）

## versions.json 格式

```json
[
    { "1.0.7": "1.12.0" },
    { "1.0.6": "1.7.0" },
    { "1.0.5": "1.4.0" }
]
```

新版本插入到数组**开头**（最新版本在前）。

## 构建脚本

```json
{
    "scripts": {
        "dev": "node esbuild.config.mjs",
        "build": "npm run lint && tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
        "lint": "eslint src/",
        "preversion": "npm run build",
        "version": "node version-bump.mjs && git add manifest.json versions.json package.json package-lock.json",
        "postversion": "git push && git push --tags"
    }
}
```

## Volta 配置

```json
{
    "volta": {
        "node": "22.22.3",
        "npm": "10.9.8"
    }
}
```

锁定 Node 和 npm 版本，确保本地和 CI 环境一致。
