import { describe, expect, it, vi } from 'vitest';
import { readdir } from 'node:fs/promises';
import { App } from 'obsidian';
import { isAbsoluteFolderPath } from '../../src/utils/folder-path';
import { AddFolderModal } from '../../src/ui/AddFolderModal';

vi.mock('node:path', async (importOriginal) => {
	const path = await importOriginal<typeof import('node:path')>();
	return { ...path, ...path.win32 };
});
vi.mock('node:os', () => ({ homedir: () => 'C:\\Users\\Reader' }));
vi.mock('node:fs/promises', () => ({ readdir: vi.fn(async () => []), stat: vi.fn() }));

describe('Windows folder selection', () => {
	it('accepts complete drive and network paths and rejects paths with an implicit drive', () => {
		for (const folder of ['C:\\Books', 'C:/Books', '\\\\server\\share\\Books']) {
			expect(isAbsoluteFolderPath(folder)).toBe(true);
		}
		for (const folder of ['C:Books', '\\Books', '/Books', '.', 'Books']) {
			expect(isAbsoluteFolderPath(folder)).toBe(false);
		}
	});

	it.each(['C:\\Books\\Li', 'C:/Books/Li'])(
		'uses the complete directory to suggest %s',
		async (query) => {
			vi.clearAllMocks();
			const modal = new AddFolderModal(new App(), vi.fn());
			const suggestions = modal.suggestionModal as unknown as {
				getSuggestions(input: string): Promise<string[]>;
			};
			await suggestions.getSuggestions(query);
			expect(readdir).toHaveBeenCalledWith('C:\\Books\\', { withFileTypes: true });
		},
	);
});
