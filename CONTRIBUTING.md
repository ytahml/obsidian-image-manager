# Contributing / 协作贡献

Thanks for helping improve Obsidian Markdown Image Manager. 欢迎参与改进 Obsidian Markdown Image Manager。

## Before you start / 开始前

- Search [existing issues](https://github.com/ytahml/obsidian-image-manager/issues) to avoid duplicate work. 先搜索[现有 Issue](https://github.com/ytahml/obsidian-image-manager/issues)，避免重复工作。
- Open an issue before starting a non-trivial feature or behavior change. 非简单功能或行为变更请先创建 Issue 沟通。

## Development / 开发

```bash
npm install
npm test
npm run build
```

Keep changes focused. Do not commit generated `main.js`. 保持改动聚焦，不要提交生成的 `main.js`。

## Pull requests / Pull Request

- Describe the user-visible change and related issue, if any. 说明用户可见的改动及关联 Issue（如有）。
- Run `npm test` and `npm run build` before opening the pull request. 提交前运行 `npm test` 与 `npm run build`。
- Update both README files when a user-visible capability changes. 用户可见能力变更时，同步更新中英文 README。
