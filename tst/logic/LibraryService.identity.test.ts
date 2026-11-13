import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type DesktopLibrary from '../../src/main';
import type { CatalogFile } from '../../src/model';
import { assertISBN10, assertISBN13 } from '../../src/model';
import { Book, MetadataUpdateStatus } from '../../src/logic/books/book';
import { bookIdentity } from '../../src/logic/books/book-identity';
import { LibraryService } from '../../src/logic/LibraryService';

const isbn10 = (() => {
	const value = '0132350882';
	assertISBN10(value);
	return value;
})();
const isbn13 = (() => {
	const value = '9780132350884';
	assertISBN13(value);
	return value;
})();
let directory: string;
function plugin(watchedFolders: string[] = []): DesktopLibrary {
	return {
		catalogDir: directory,
		catalogPath: join(directory, 'Catalog.json'),
		settings: { watchedFolders, onlineLookupEnabled: false },
	} as DesktopLibrary;
}
function add(service: LibraryService, book: Book) {
	(service as unknown as { catalog: Map<string, Book> }).catalog.set(book.Filepath, book);
}
function copy(filepath: string, ten = false): Book {
	return new Book({
		filepath,
		title: 'Local title',
		author: 'Unknown',
		...(ten ? { isbn10 } : { isbn13 }),
		lastUpdateAttempt: 100,
	});
}
async function disk(): Promise<CatalogFile> {
	return JSON.parse(await readFile(plugin().catalogPath, 'utf8')) as CatalogFile;
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'shelf-isbn-'));
	vi.stubGlobal('window', { setTimeout, clearTimeout });
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	await rm(directory, { recursive: true, force: true });
});

describe('ISBN catalog identity', () => {
	it('normalizes ISBN-10 to ISBN-13 but keeps other editions and invalid identifiers separate', () => {
		expect(bookIdentity(copy('/a.pdf', true).props)).toBe(`isbn:${isbn13}`);
		expect(bookIdentity(copy('/b.pdf').props)).toBe(`isbn:${isbn13}`);
		const other = '9780262033848';
		assertISBN13(other);
		expect(bookIdentity({ ...copy('/a.pdf').props, isbn13: other })).not.toBe(`isbn:${isbn13}`);
		expect(bookIdentity({ ...copy('/a.pdf').props, isbn13: 'invalid' as typeof isbn13 })).toBe(
			'/a.pdf',
		);
	});
	it('migrates legacy path records into one ISBN record without losing locations or fetched metadata', async () => {
		const a = copy(join(directory, 'a.pdf'), true);
		const b = copy(join(directory, 'b.pdf'));
		a.Title = 'Fetched title';
		a.MetaDataUpdateStatus = MetadataUpdateStatus.SUCCESS;
		b.LastUpdateAttempt = 200;
		await writeFile(
			plugin().catalogPath,
			JSON.stringify({
				lastUpdated: 1,
				data: { [a.Filepath]: a.props, [b.Filepath]: b.props },
			}),
		);
		const service = new LibraryService(plugin());
		await service.importCatalog();
		expect(service.books).toHaveLength(1);
		expect(service.books[0]?.title).toBe('Fetched title');
		expect(service.books[0]?.filepaths).toEqual([a.Filepath, b.Filepath]);
		expect(Object.isFrozen(service.books[0]?.filepaths)).toBe(true);
		await service.exportCatalog();
		expect(Object.keys((await disk()).data)).toEqual([`isbn:${isbn13}`]);
		const restored = new LibraryService(plugin());
		await restored.importCatalog();
		expect(restored.books).toEqual(service.books);
	});
	it('merges concurrent vault writes with the same ISBN into one record containing both copies', async () => {
		const a = new LibraryService(plugin());
		const b = new LibraryService(plugin());
		add(a, copy(join(directory, 'a.pdf'), true));
		add(b, copy(join(directory, 'b.pdf')));
		await Promise.all([a.exportCatalog(), b.exportCatalog()]);
		const saved = await disk();
		expect(Object.keys(saved.data)).toEqual([`isbn:${isbn13}`]);
		expect(saved.data[`isbn:${isbn13}`]?.filepaths).toEqual([
			join(directory, 'a.pdf'),
			join(directory, 'b.pdf'),
		]);
	});
	it('updates metadata once per ISBN and removes only a missing copy after a successful scan', async () => {
		const rootA = join(directory, 'a');
		const rootB = join(directory, 'b');
		await mkdir(rootA);
		await mkdir(rootB);
		const pathA = join(rootA, 'copy.pdf');
		const pathB = join(rootB, 'copy.pdf');
		await writeFile(pathA, 'cached');
		await writeFile(pathB, 'cached');
		const initial = new LibraryService(plugin());
		add(initial, copy(pathA, true));
		add(initial, copy(pathB));
		await initial.exportCatalog();
		const service = new LibraryService(plugin([rootA, rootB]));
		await service.importCatalog();
		const update = vi.spyOn(service, 'updateBook').mockImplementation(async (book) => {
			book.Title = 'Shared metadata';
			book.MetaDataUpdateStatus = MetadataUpdateStatus.SUCCESS;
			book.LastUpdateAttempt = 300;
		});
		await service.updateCatalog();
		expect(update).toHaveBeenCalledOnce();
		expect(service.books).toHaveLength(1);
		expect(service.books[0]?.title).toBe('Shared metadata');
		await rm(pathA);
		await service.updateCatalog();
		expect(service.books[0]?.filepaths).toEqual([pathB]);
		expect(service.books[0]?.title).toBe('Shared metadata');
		expect((await disk()).data[`isbn:${isbn13}`]?.filepaths).toEqual([pathB]);
	});
});
