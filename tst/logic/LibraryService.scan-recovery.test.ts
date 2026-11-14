import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadPdfJs } from 'obsidian';
import type DesktopLibrary from '../../src/main';
import type { CatalogFile } from '../../src/model/catalog';
import { LibraryService } from '../../src/logic/LibraryService';

vi.mock('../../src/logic/books/directory-crawler', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/logic/books/directory-crawler')>();
	return { ...actual, getPDFPaths: vi.fn(actual.getPDFPaths) };
});
import { getPDFPaths } from '../../src/logic/books/directory-crawler';

const fixture = resolve('docs/misc/sample-test-fixture.pdf');
let directory: string;
let folder: string;
function plugin(folders = [folder]): DesktopLibrary {
	return {
		catalogDir: directory,
		catalogPath: join(directory, 'Catalog.json'),
		settings: { watchedFolders: folders, onlineLookupEnabled: false },
	} as unknown as DesktopLibrary;
}
async function catalog(): Promise<CatalogFile> {
	return JSON.parse(await readFile(plugin().catalogPath, 'utf8')) as CatalogFile;
}
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'shelf-recovery-'));
	folder = join(directory, 'books');
	await mkdir(folder);
	vi.mocked(getPDFPaths).mockReset();
	const actual = await vi.importActual<typeof import('../../src/logic/books/directory-crawler')>(
		'../../src/logic/books/directory-crawler',
	);
	vi.mocked(getPDFPaths).mockImplementation(actual.getPDFPaths);
	vi.mocked(loadPdfJs).mockClear();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
	vi.restoreAllMocks();
	await rm(directory, { recursive: true, force: true });
});

describe('scan recovery', () => {
	it('retries a failed extraction after reload without requiring the PDF to change', async () => {
		const path = join(folder, 'book.pdf');
		await copyFile(fixture, path);
		vi.mocked(loadPdfJs).mockRejectedValueOnce(new Error('Transient PDF loader failure'));
		const service = new LibraryService(plugin());
		await service.updateCatalog();
		expect(service.issues).toEqual([`Could not read PDF: ${path}`]);
		expect(service.edits.candidates).toHaveLength(0);
		expect((await catalog()).scans?.[path]).toBeUndefined();

		const reloaded = new LibraryService(plugin());
		await reloaded.updateCatalog();
		expect(loadPdfJs).toHaveBeenCalledTimes(2);
		expect(reloaded.books[0]?.isbn13).toBe('9780999999998');
		expect(reloaded.issues).toEqual([]);
		await reloaded.updateCatalog();
		expect(loadPdfJs).toHaveBeenCalledTimes(2);
	});

	it('keeps the previous book and fingerprint when extraction of a changed PDF fails', async () => {
		const path = join(folder, 'book.pdf');
		await copyFile(fixture, path);
		const service = new LibraryService(plugin());
		await service.updateCatalog();
		const before = await catalog();
		const previous = service.books;
		// A harmless trailing newline changes the fingerprint of this valid PDF.
		await writeFile(path, Buffer.concat([await readFile(path), Buffer.from('\n')]));
		vi.mocked(loadPdfJs).mockRejectedValueOnce(new Error('Transient PDF loader failure'));
		await service.updateCatalog();
		expect(service.books).toEqual(previous);
		expect((await catalog()).scans?.[path]).toEqual(before.scans?.[path]);
		expect(service.issues).toEqual([`Could not read PDF: ${path}`]);
		await service.updateCatalog();
		expect(loadPdfJs).toHaveBeenCalledTimes(3);
		expect((await catalog()).scans?.[path]).not.toEqual(before.scans?.[path]);
		expect(service.issues).toEqual([]);
	});

	it.each([false, true])(
		'retains discoveries when an overlapping parent scan fails (child first: %s)',
		async (childFirst) => {
			const child = join(folder, 'child');
			await mkdir(child);
			const path = join(child, 'new.pdf');
			await copyFile(fixture, path);
			const missing = join(child, 'removed.pdf');
			const offline = join(folder, 'offline', 'retained.pdf');
			await writeFile(
				plugin().catalogPath,
				JSON.stringify({
					lastUpdated: 1,
					data: {},
					pendingFiles: Object.fromEntries(
						[missing, offline].map((filepath) => [
							filepath,
							{
								filepath,
								title: 'Cached book',
								author: 'Unknown',
							},
						]),
					),
				}),
			);
			vi.mocked(getPDFPaths).mockImplementation(async function* (root) {
				yield path;
				if (root === folder) throw new Error('Unreadable sibling directory');
			});
			const service = new LibraryService(
				plugin(childFirst ? [child, folder] : [folder, child]),
			);
			await service.updateCatalog();
			expect(service.books[0]?.filepaths).toEqual([path]);
			expect(loadPdfJs).toHaveBeenCalledOnce();
			expect(service.issues).toEqual([`Could not scan folder: ${folder}`]);
			const saved = await catalog();
			expect(saved.scans?.[path]).toBeDefined();
			expect(saved.pendingFiles?.[missing]).toBeUndefined();
			expect(saved.pendingFiles?.[offline]).toBeDefined();
			const reloaded = new LibraryService(plugin());
			await reloaded.importCatalog();
			expect(reloaded.books).toEqual(service.books);
		},
	);
});
