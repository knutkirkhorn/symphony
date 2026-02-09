import js from '@eslint/js';
// import pluginRouter from '@tanstack/eslint-plugin-router';
import eslintConfigPrettier from 'eslint-config-prettier';
// import reactCompiler from 'eslint-plugin-react-compiler';
// import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import {defineConfig} from 'eslint/config';
import globals from 'globals';
import tsEslint from 'typescript-eslint';

export default defineConfig([
	js.configs.recommended,
	tsEslint.configs.recommended,
	eslintPluginUnicorn.configs.recommended,
	eslintConfigPrettier,
	// pluginRouter.configs['flat/recommended'],
	// reactHooks.configs['recommended-latest'],
	// reactCompiler.configs.recommended,
	reactRefresh.configs.recommended,
	{
		ignores: ['src/routeTree.gen.ts', 'dist/*', 'src-tauri/*'],
	},
	{
		files: ['**/*.{js,mjs,cjs,jsx,mjsx,ts,tsx,mtsx}'],
		languageOptions: {
			globals: {...globals.browser},

			ecmaVersion: 2025,
		},

		rules: {
			// Disable rules
			'no-console': 'off',
			'no-plusplus': 'off',
			'no-await-in-loop': 'off',
			'no-restricted-syntax': 'off',

			// Enable rules
			'no-param-reassign': 'error',
			'consistent-return': 'error',
			'no-else-return': 'error',
			'no-var': 'error',
			'prefer-const': 'error',

			'unicorn/prevent-abbreviations': [
				'error',
				{
					allowList: {
						env: true,
						db: true,
						utils: true,
					},
				},
			],
		},
	},
]);
