import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type DesktopLibrary from '../../src/main';
import type { CatalogFile } from '../../src/model/catalog';
import { Book, MetadataUpdateStatus } from '../../src/logic/books/book';
import { LibraryService } from '../../src/logic/LibraryService';
import { parseManualISBN } from '../../src/logic/manual-state';

let directory: string;
const isbn = '9780132350884';
const otherISBN = '9780262033848';
const key = `isbn:${isbn}`;
function plugin(): DesktopLibrary {
	return {
		catalogDir: directory,
		catalogPath: join(directory, 'Catalog.json'),
		settings: { watchedFolders: [], onlineLookupEnabled: false },
	} as unknown as DesktopLibrary;
}
async function disk(): Promise<CatalogFile> {
	return JSON.parse(await readFile(plugin().catalogPath, 'utf8')) as CatalogFile;
}
async function setup() {
	const a = join(directory, 'a.pdf');
	const b = join(directory, 'b.pdf');
	const unknown = join(directory, 'unknown.pdf');
	const shared = {
		title: 'Fetched title',
		author: 'Fetched author',
		...parseManualISBN(isbn),
		metaDataStatus: MetadataUpdateStatus.SUCCESS,
		lastUpdateAttempt: 100,
	};
	await writeFile(
		plugin().catalogPath,
		JSON.stringify({
			lastUpdated: 1,
			data: {
				[a]: new Book({ ...shared, filepath: a }).props,
				[b]: new Book({ ...shared, filepath: b }).props,
				[unknown]: new Book({ filepath: unknown, title: 'unknown.pdf', author: 'Unknown' })
					.props,
			},
		}),
	);
	const service = new LibraryService(plugin());
	await service.importCatalog();
	return { a, b, unknown, service };
}
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'shelf-edits-'));
	vi.stubGlobal('window', { setTimeout, clearTimeout });
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	await rm(directory, { recursive: true, force: true });
});

describe('manual library edits', () => {
	it('validates ISBNs and metadata before changing the catalog', async () => {
		const { service, unknown } = await setup();
		const before = await disk();
		expect(parseManualISBN('0-132-35088-2')).toEqual({ isbn10: '0132350882' });
		for (const input of ['123', '9780132350880', 'abcdefghij', '0000000000000']) {
			await expect(service.edits.assignISBN(unknown, input)).rejects.toThrow();
		}
		await expect(service.edits.saveOverrides(key, { title: ' ' })).rejects.toThrow();
		await expect(service.edits.saveOverrides(key, { year: NaN })).rejects.toThrow();
		expect(await disk()).toEqual(before);
	});
	it('keeps overrides separate from fetched metadata and resets individual fields', async () => {
		const { service } = await setup();
		await service.edits.saveOverrides(key, { title: 'My title', year: 2024 });
		expect(service.books.find((book) => book.isbn13 === isbn)).toMatchObject({
			title: 'My title',
			year: 2024,
		});
		expect((await disk()).data[key]?.title).toBe('Fetched title');
		const stale = new LibraryService(plugin());
		await stale.importCatalog();
		await service.edits.saveOverrides(key, { publisher: 'My publisher' });
		await stale.edits.saveOverrides(key, { author: 'My author' });
		await service.exportCatalog();
		expect(service.books.find((book) => book.isbn13 === isbn)).toMatchObject({
			title: 'My title',
			author: 'My author',
			publisher: 'My publisher',
			year: 2024,
		});
		await service.edits.saveOverrides(key, { title: null });
		expect(service.books.find((book) => book.isbn13 === isbn)).toMatchObject({
			title: 'Fetched title',
			author: 'My author',
		});
	});
	it('previews and confirms ISBN merges, retaining all copies and existing target overrides', async () => {
		const { service, a, b, unknown } = await setup();
		await service.edits.saveOverrides(unknown, {
			title: 'Manual unidentified title',
			author: 'Manual author',
		});
		await service.edits.saveOverrides(key, { title: 'Target title' });
		expect(service.edits.previewISBN(unknown, '0132350882')?.title).toBe('Target title');
		await expect(service.edits.assignISBN(unknown, isbn)).rejects.toThrow('merge preview');
		await service.edits.assignISBN(unknown, '0132350882', key);
		expect(service.books).toHaveLength(1);
		expect(service.books[0]).toMatchObject({
			title: 'Target title',
			author: 'Manual author',
			filepaths: [a, b, unknown],
		});
		const reloaded = new LibraryService(plugin());
		await reloaded.importCatalog();
		expect(reloaded.books).toEqual(service.books);
	});
	it('corrects only one copy and protects the correction against stale exports', async () => {
		const { service, a, b } = await setup();
		const stale = new LibraryService(plugin());
		await stale.importCatalog();
		await service.edits.saveOverrides(key, { title: 'Original edition title' });
		await service.edits.assignISBN(a, otherISBN);
		expect(service.books.find((book) => book.isbn13 === isbn)?.filepaths).toEqual([b]);
		expect(service.books.find((book) => book.isbn13 === otherISBN)).toMatchObject({
			title: 'a.pdf',
			author: 'Unknown',
			filepaths: [a],
		});
		await stale.exportCatalog();
		const reloaded = new LibraryService(plugin());
		await reloaded.importCatalog();
		expect(reloaded.books.find((book) => book.isbn13 === otherISBN)?.filepaths).toEqual([a]);
		expect(reloaded.books.find((book) => book.isbn13 === isbn)?.title).toBe(
			'Original edition title',
		);
	});

	it('preserves concurrent edits and explicit inclusions, and removing inclusion stays removed', async () => {
		const { service, unknown } = await setup();
		const second = new LibraryService(plugin());
		await second.importCatalog();
		expect(service.books).toHaveLength(1);
		expect(service.edits.candidates.map((book) => book.filepath)).toEqual([unknown]);
		const pending = service.edits.candidates;
		service.reportStatus('Scanning folders…');
		expect(service.edits.candidates).toBe(pending);
		await Promise.all([
			service.edits.setIncluded(unknown, true),
			second.edits.saveOverrides(key, { title: 'Concurrent title' }),
		]);
		await service.importCatalog();
		expect(service.books).toHaveLength(2);
		expect(service.books.find((book) => book.isbn13 === isbn)?.title).toBe('Concurrent title');
		expect(service.edits.candidates).toHaveLength(0);
		await second.importCatalog();
		await service.edits.setIncluded(unknown, false);
		await second.exportCatalog();
		await service.importCatalog();
		expect(service.books).toHaveLength(1);
		expect(service.edits.candidates.map((book) => book.filepath)).toEqual([unknown]);
	});
	it('migrates permissive catalogs without automatically including unidentified entries', async () => {
		const { service, unknown } = await setup();
		expect(service.books).toHaveLength(1);
		await service.exportCatalog();
		const saved = await disk();
		expect(saved.data[unknown]).toBeUndefined();
		expect(saved.pendingFiles?.[unknown]?.title).toBe('unknown.pdf');
		expect(saved.manual?.includedFiles).toEqual([]);
		const reloaded = new LibraryService(plugin());
		await reloaded.importCatalog();
		expect(reloaded.books).toEqual(service.books);
		await expect(reloaded.edits.setIncluded('/missing.pdf', true)).rejects.toThrow();
	});

	it('retains the last successful state and releases the lock when a save fails', async () => {
		const { service } = await setup();
		const previous = service.books;
		await writeFile(plugin().catalogPath, 'broken catalog');
		await expect(service.edits.saveOverrides(key, { title: 'Unsaved' })).rejects.toThrow();
		expect(service.books).toBe(previous);
		await expect(readFile(`${plugin().catalogPath}.lock`)).rejects.toMatchObject({
			code: 'ENOENT',
		});
	});
});
