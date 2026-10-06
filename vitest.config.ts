import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	test: {
		environment: 'node',
	},

	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL('./tst/mocks/obsidian.ts', import.meta.url)),
		},
	},
});
