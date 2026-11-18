import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type DesktopLibrary from '../../src/main';
import { LibraryService } from '../../src/logic/LibraryService';
import { enqueuePreview } from '../../src/utils/preview-queue';

let directory: string;
let plugin: DesktopLibrary;
let service: LibraryService;
beforeEach(async () => {
	vi.stubGlobal('window', { setTimeout, clearTimeout });
	directory = await mkdtemp(join(tmpdir(), 'shelf-clear-'));
	const catalogDir = join(directory, '.obsidian-desktop-shelf');
	plugin = {
		catalogDir,
		catalogPath: join(catalogDir, 'Catalog.json'),
		imagesDir: join(catalogDir, 'covers'),
		settings: {
			watchedFolders: [directory],
			onlineLookupEnabled: false,
			saveDirectory: directory,
		},
		saveSettings: vi.fn(async () => {}),
	} as unknown as DesktopLibrary;
	await mkdir(join(plugin.imagesDir, 'previews'), { recursive: true });
	await writeFile(join(directory, 'original.pdf'), 'original PDF');
	await writeFile(join(catalogDir, 'unrelated.txt'), 'keep');
	await writeFile(join(plugin.imagesDir, 'cover.jpg'), 'cover');
	await writeFile(join(plugin.imagesDir, 'previews', 'page.png'), 'preview');
	await writeFile(
		plugin.catalogPath,
		JSON.stringify({
			lastUpdated: 1,
			data: { '/book.pdf': { filepath: '/book.pdf', title: 'Book', author: 'Ada' } },
			manual: { includedFiles: ['/book.pdf'], overrides: {}, identifications: {} },
			settings: { watchedFolders: [directory] },
		}),
	);
	service = new LibraryService(plugin);
	await service.importCatalog();
});
afterEach(async () => {
	vi.unstubAllGlobals();
	await rm(directory, { recursive: true, force: true });
});

describe('clearing the library', () => {
	it('deletes only the catalog and image cache, clears memory, and preserves folders and PDFs', async () => {
		expect(service.books).toHaveLength(1);
		await service.clearLibrary();
		await expect(readFile(plugin.catalogPath)).rejects.toMatchObject({ code: 'ENOENT' });
		await expect(readFile(join(plugin.imagesDir, 'cover.jpg'))).rejects.toMatchObject({
			code: 'ENOENT',
		});
		await expect(
			readFile(join(plugin.imagesDir, 'previews', 'page.png')),
		).rejects.toMatchObject({ code: 'ENOENT' });
		expect(await readFile(join(directory, 'original.pdf'), 'utf8')).toBe('original PDF');
		expect(await readFile(join(plugin.catalogDir, 'unrelated.txt'), 'utf8')).toBe('keep');
		expect(plugin.settings.watchedFolders).toEqual([directory]);
		expect(service.books).toEqual([]);
		expect(service.edits.candidates).toEqual([]);
		expect(service.status).toBe('Library cleared');
		// Repeating the action is safe even when the files are already absent.
		await service.clearLibrary();
	});

	it('waits for queued writes and preview generation before deleting files', async () => {
		let finish!: () => void;
		const preview = enqueuePreview(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
		const write = service.setWatchedFolder('/additional', true);
		const clearing = service.clearLibrary();
		expect(service.clearLibrary()).toBe(clearing);
		expect(service.updateCatalog()).toBe(clearing);
		expect(service.isClearing).toBe(true);
		await write;
		expect(await readFile(join(plugin.imagesDir, 'cover.jpg'), 'utf8')).toBe('cover');
		finish();
		await preview;
		await clearing;
		expect(plugin.settings.watchedFolders).toEqual([directory, '/additional']);
		await expect(readFile(plugin.catalogPath)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('uses the catalog lock before removing cached data', async () => {
		const lockPath = `${plugin.catalogPath}.lock`;
		const lock = await open(lockPath, 'wx');
		const clearing = service.clearLibrary();
		try {
			await vi.waitFor(() => expect(service.status).toBe('Clearing library…'));
			expect(await readFile(join(plugin.imagesDir, 'cover.jpg'), 'utf8')).toBe('cover');
		} finally {
			await lock.close();
			await rm(lockPath);
		}
		await clearing;
		await expect(readFile(plugin.catalogPath)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('does not delete anything when preserving watched folders fails', async () => {
		plugin.saveSettings = vi.fn().mockRejectedValue(new Error('Disk full'));
		await expect(service.clearLibrary()).rejects.toThrow('Disk full');
		expect(service.isClearing).toBe(false);
		expect(service.books).toHaveLength(1);
		expect(await readFile(join(plugin.imagesDir, 'cover.jpg'), 'utf8')).toBe('cover');
		await expect(readFile(plugin.catalogPath)).resolves.toBeDefined();
	});
});
