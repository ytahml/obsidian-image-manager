import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
	...obsidianmd.configs.recommended,
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ["package.json"],
		rules: {
			"obsidianmd/no-plugin-as-component": "off",
		},
	},
	{
		files: ["src/settings.ts"],
		rules: {
			// display() 已废弃但 getSettingDefinitions() 是声明式 API，
			// 当前 settings.ts 有动态图床列表等复杂逻辑，全面重写风险大
			"@typescript-eslint/no-deprecated": "off",
		},
	},
);
