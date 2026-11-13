import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type DesktopLibrary from '../../src/main';
import { LibraryService } from '../../src/logic/LibraryService';
import { Book } from '../../src/logic/books/book';
import type { CatalogFile } from '../../src/model';

let testDirectory: string;

function makePlugin(watchedFolders: string[] = []): DesktopLibrary {
	const catalogDir = join(testDirectory, 'catalog');
	return {
		catalogDir,
		catalogPath: join(catalogDir, 'Catalog.json'),
		settings: { watchedFolders, saveDirectory: testDirectory },
	} as unknown as DesktopLibrary;
}

function addBook(service: LibraryService, filepath: string, title: string): void {
	const state = service as unknown as { catalog: Map<string, Book> };
	state.catalog.set(filepath, new Book({ filepath, title, author: 'Unknown' }));
}

function addBookWithUpdateTime(
	service: LibraryService,
	filepath: string,
	title: string,
	lastUpdateAttempt: number,
): void {
	const book = new Book({ filepath, title, author: 'Unknown' });
	book.LastUpdateAttempt = lastUpdateAttempt;
	const state = service as unknown as { catalog: Map<string, Book> };
	state.catalog.set(filepath, book);
}

async function readCatalog(): Promise<CatalogFile> {
	return JSON.parse(
		await readFile(join(testDirectory, 'catalog', 'Catalog.json'), 'utf-8'),
	) as CatalogFile;
}

describe('LibraryService catalog persistence', () => {
	beforeEach(() => {
		vi.stubGlobal('window', { setTimeout, clearTimeout });
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
	});

	it('merges stale vault snapshots instead of overwriting entries written by another vault', async () => {
		testDirectory = await mkdtemp(join(tmpdir(), 'desktop-shelf-catalog-'));
		const vaultA = new LibraryService(makePlugin());
		const vaultB = new LibraryService(makePlugin());
		await Promise.all([vaultA.importCatalog(), vaultB.importCatalog()]);

		addBook(vaultA, join(testDirectory, 'books-a', 'a.pdf'), 'Book A');
		addBook(vaultB, join(testDirectory, 'books-b', 'b.pdf'), 'Book B');

		await Promise.all([
			vaultA.exportCatalog([join(testDirectory, 'books-a')]),
			vaultB.exportCatalog([join(testDirectory, 'books-b')]),
		]);

		const { data } = await readCatalog();
		expect(data).toHaveProperty(join(testDirectory, 'books-a', 'a.pdf'));
		expect(data).toHaveProperty(join(testDirectory, 'books-b', 'b.pdf'));
	});

	it('removes stale entries only under successfully scanned folders', async () => {
		testDirectory = await mkdtemp(join(tmpdir(), 'desktop-shelf-catalog-'));
		const rootA = join(testDirectory, 'books-a');
		const pathA = join(rootA, 'removed.pdf');
		const pathB = join(testDirectory, 'books-b', 'retained.pdf');
		const service = new LibraryService(makePlugin());
		addBook(service, pathA, 'Removed book');
		addBook(service, pathB, 'Retained book');
		await service.exportCatalog();

		const scanner = new LibraryService(makePlugin());
		await scanner.importCatalog();
		const state = scanner as unknown as { catalog: Map<string, Book> };
		state.catalog.delete(pathA);
		await scanner.exportCatalog([rootA]);

		const { data } = await readCatalog();
		expect(data).not.toHaveProperty(pathA);
		expect(data).toHaveProperty(pathB);
	});

	it('keeps the newer record when stale vaults scan the same path', async () => {
		testDirectory = await mkdtemp(join(tmpdir(), 'desktop-shelf-catalog-'));
		const root = join(testDirectory, 'shared-books');
		const filepath = join(root, 'book.pdf');
		const olderVault = new LibraryService(makePlugin());
		const newerVault = new LibraryService(makePlugin());
		await Promise.all([olderVault.importCatalog(), newerVault.importCatalog()]);

		addBookWithUpdateTime(olderVault, filepath, 'Older title', 100);
		await olderVault.exportCatalog([root]);
		addBookWithUpdateTime(newerVault, filepath, 'Newer title', 200);
		await newerVault.exportCatalog([root]);
		await olderVault.exportCatalog([root]);

		const { data } = await readCatalog();
		expect(data[filepath]?.title).toBe('Newer title');
	});

	it('saves newer metadata even when the watched folder cannot be scanned', async () => {
		testDirectory = await mkdtemp(join(tmpdir(), 'desktop-shelf-catalog-'));
		const root = join(testDirectory, 'unavailable-books');
		const filepath = join(root, 'retained.pdf');
		const initial = new LibraryService(makePlugin());
		addBookWithUpdateTime(initial, filepath, 'Old title', 100);
		await initial.exportCatalog();
		const service = new LibraryService(makePlugin([root]));
		await service.importCatalog();
		vi.spyOn(service, 'updateBook').mockImplementation(async (book) => {
			book.Title = 'Updated title';
			book.LastUpdateAttempt = 200;
		});
		await service.updateCatalog();
		expect((await readCatalog()).data[filepath]?.title).toBe('Updated title');
	});

	it('does not export the catalog when cancelled during metadata updates', async () => {
		testDirectory = await mkdtemp(join(tmpdir(), 'desktop-shelf-catalog-'));
		const root = join(testDirectory, 'unavailable-books');
		const initial = new LibraryService(makePlugin());
		addBook(initial, join(root, 'retained.pdf'), 'Local title');
		await initial.exportCatalog();
		const before = await readCatalog();
		const service = new LibraryService(makePlugin([root]));
		await service.importCatalog();
		const controller = new AbortController();
		vi.spyOn(service, 'updateBook').mockImplementation(async () => {
			controller.abort();
		});
		const exportSpy = vi.spyOn(service, 'exportCatalog');
		await expect(service.updateCatalog(controller.signal)).rejects.toMatchObject({
			name: 'AbortError',
		});
		expect(exportSpy).not.toHaveBeenCalled();
		expect(await readCatalog()).toEqual(before);
	});

	it('preserves catalog entries when their watched folder cannot be scanned', async () => {
		testDirectory = await mkdtemp(join(tmpdir(), 'desktop-shelf-catalog-'));
		const root = join(testDirectory, 'unavailable-books');
		const filepath = join(root, 'retained.pdf');
		const initial = new LibraryService(makePlugin());
		addBook(initial, filepath, 'Retained book');
		await initial.exportCatalog();

		const service = new LibraryService(makePlugin([root]));
		await service.importCatalog();
		await service.updateCatalog();

		const { data } = await readCatalog();
		expect(data).toHaveProperty(filepath);
	});
});
