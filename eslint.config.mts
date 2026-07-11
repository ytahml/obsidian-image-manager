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
		files: ['tests/**/*.ts'],
		rules: {
			// Tests run in Node.js and may inspect repository files.
			'import/no-nodejs-modules': 'off',
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
			// display() 已废弃但 getSettingDefinitions() 需要 Obsidian 1.13.0+
			// 当前 minAppVersion=1.12.0，暂用 display() 命令式 API
			"@typescript-eslint/no-deprecated": "off",
		},
	},
);
