import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type DesktopLibrary from '../../src/main';
import type { CatalogFile } from '../../src/model/catalog';
import { LibraryService } from '../../src/logic/LibraryService';

let directory: string;
function plugin(watchedFolders: string[] = []): DesktopLibrary {
	return {
		catalogDir: directory,
		catalogPath: join(directory, 'Catalog.json'),
		settings: { watchedFolders, onlineLookupEnabled: false, saveDirectory: directory },
	} as DesktopLibrary;
}
async function disk(): Promise<CatalogFile> {
	return JSON.parse(await readFile(plugin().catalogPath, 'utf8')) as CatalogFile;
}
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'shelf-settings-'));
	vi.stubGlobal('window', { setTimeout, clearTimeout });
});
afterEach(async () => {
	vi.unstubAllGlobals();
	await rm(directory, { recursive: true, force: true });
});

describe('catalog folder settings', () => {
	it('rejects new relative roots and allows removing a legacy relative root after refresh', async () => {
		const p = plugin();
		const service = new LibraryService(p);
		await expect(service.setWatchedFolder('books', true)).rejects.toThrow(
			'absolute folder path',
		);
		await expect(readFile(p.catalogPath)).rejects.toMatchObject({ code: 'ENOENT' });
		await writeFile(
			p.catalogPath,
			JSON.stringify({ lastUpdated: 1, data: {}, settings: { watchedFolders: ['.'] } }),
		);
		await service.updateCatalog();
		expect(service.issues).toEqual([
			'Replace this watched folder with its full path in settings: .',
		]);
		expect(service.edits.candidates).toHaveLength(0);
		await service.setWatchedFolder('.', false);
		expect((await disk()).settings?.watchedFolders).toEqual([]);
	});

	it('migrates legacy folders on refresh and loads them in a new vault', async () => {
		const folder = join(directory, 'books');
		await mkdir(folder);
		await writeFile(plugin().catalogPath, JSON.stringify({ lastUpdated: 1, data: {} }));
		const first = new LibraryService(plugin([folder]));
		await first.updateCatalog();
		expect((await disk()).settings).toEqual({ watchedFolders: [folder] });
		const other = plugin();
		const second = new LibraryService(other);
		await second.importCatalog();
		expect(other.settings.watchedFolders).toEqual([folder]);
		expect(other.settings.onlineLookupEnabled).toBe(false);
	});

	it('leaves legacy migration available when a fresh vault opens the catalog first', async () => {
		const folder = join(directory, 'books');
		await mkdir(folder);
		const path = join(folder, 'old.pdf');
		await writeFile(
			plugin().catalogPath,
			JSON.stringify({
				lastUpdated: 1,
				data: {},
				pendingFiles: { [path]: { filepath: path, title: 'Old book', author: 'Unknown' } },
			}),
		);
		await new LibraryService(plugin()).updateCatalog();
		expect((await disk()).settings).toBeUndefined();
		await new LibraryService(plugin([folder])).updateCatalog();
		expect((await disk()).settings?.watchedFolders).toEqual([folder]);
	});

	it('merges concurrent additions and never restores removals from stale exports', async () => {
		const a = join(directory, 'a');
		const b = join(directory, 'b');
		const first = new LibraryService(plugin());
		const otherPlugin = plugin([a]);
		const second = new LibraryService(otherPlugin);
		await Promise.all([first.setWatchedFolder(a, true), second.setWatchedFolder(b, true)]);
		expect((await disk()).settings?.watchedFolders.sort()).toEqual([a, b]);
		await second.importCatalog();
		await first.setWatchedFolder(a, false);
		await second.exportCatalog();
		expect(otherPlugin.settings.watchedFolders).toEqual([b]);
		await first.setWatchedFolder(b, false);
		const stalePlugin = plugin([a, b]);
		await new LibraryService(stalePlugin).updateCatalog();
		expect(stalePlugin.settings.watchedFolders).toEqual([]);
		expect((await disk()).settings?.watchedFolders).toEqual([]);
	});

	it('refreshes using catalog folders rather than a stale vault list', async () => {
		const folder = join(directory, 'books');
		await mkdir(folder);
		const path = join(folder, 'deleted.pdf');
		await writeFile(
			plugin().catalogPath,
			JSON.stringify({
				lastUpdated: 1,
				data: {},
				settings: { watchedFolders: [folder] },
				pendingFiles: { [path]: { filepath: path, title: 'Deleted', author: 'Unknown' } },
			}),
		);
		const other = plugin([join(directory, 'wrong-folder')]);
		const service = new LibraryService(other);
		await service.updateCatalog();
		expect(other.settings.watchedFolders).toEqual([folder]);
		expect(service.edits.candidates).toEqual([]);
		expect(service.issues).toEqual([]);
	});

	it('does not change in-memory folders when persistence fails', async () => {
		const p = plugin(['/original']);
		const service = new LibraryService(p);
		await writeFile(p.catalogPath, 'broken JSON');
		await expect(service.setWatchedFolder('/new', true)).rejects.toThrow();
		expect(p.settings.watchedFolders).toEqual(['/original']);
	});
});
