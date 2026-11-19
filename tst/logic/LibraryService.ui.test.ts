import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type DesktopLibrary from '../../src/main';
import { LibraryService } from '../../src/logic/LibraryService';
import { MetadataUpdateStatus } from '../../src/logic/books/book';
import { parseManualISBN } from '../../src/logic/manual-state';

describe('LibraryService view integration', () => {
	it.each([false, true])(
		'publishes metadata together while retaining progress updates (cancel: %s)',
		async (cancel) => {
			const directory = await mkdtemp(join(tmpdir(), 'shelf-ui-'));
			try {
				const catalogPath = join(directory, 'Catalog.json');
				const data = Object.fromEntries(
					['9780132350884', '9780262033848', '9780999999998'].map((isbn, index) => {
						const filepath = join(directory, `${index}.pdf`);
						return [
							filepath,
							{
								filepath,
								title: `Local ${index}`,
								author: 'Unknown',
								lastUpdateAttempt: 1,
								...parseManualISBN(isbn),
							},
						];
					}),
				);
				const pendingPath = join(directory, 'unidentified.pdf');
				await writeFile(
					catalogPath,
					JSON.stringify({
						lastUpdated: 1,
						data,
						pendingFiles: {
							[pendingPath]: { filepath: pendingPath, title: 'Unidentified' },
						},
					}),
				);
				const service = new LibraryService({
					catalogPath,
					catalogDir: directory,
					settings: { watchedFolders: [], onlineLookupEnabled: true },
				} as unknown as DesktopLibrary);
				const controller = new AbortController();
				let completed = 0;
				vi.spyOn(service, 'updateBook').mockImplementation(async (book) => {
					if (cancel && completed === 1) {
						controller.abort();
						throw new DOMException('Cancelled', 'AbortError');
					}
					book.Title = `Fetched ${completed++}`;
					book.MetaDataUpdateStatus = MetadataUpdateStatus.SUCCESS;
					book.LastUpdateAttempt = Date.now();
				});
				const snapshots: (typeof service.books)[] = [];
				const candidates: (typeof service.edits.candidates)[] = [];
				const progress: string[] = [];
				service.subscribe(() => {
					if (!service.status.startsWith('Looking up books')) return;
					progress.push(service.status);
					snapshots.push(service.books);
					candidates.push(service.edits.candidates);
				});
				const refresh = service.updateCatalog(controller.signal);
				if (cancel) await expect(refresh).rejects.toMatchObject({ name: 'AbortError' });
				else await refresh;
				expect(new Set(progress).size).toBe(cancel ? 2 : 3);
				expect(snapshots).toHaveLength(cancel ? 3 : 4);
				// The final notification may still carry the last lookup status.
				expect(new Set(snapshots.slice(0, -1)).size).toBe(1);
				expect(new Set(candidates.slice(0, -1)).size).toBe(1);
				expect(
					service.books.filter((book) => book.title.startsWith('Fetched')),
				).toHaveLength(cancel ? 1 : 3);
				expect(service.books).not.toBe(snapshots[0]);
				expect(snapshots[0]?.every((book) => book.title.startsWith('Local'))).toBe(true);
			} finally {
				vi.restoreAllMocks();
				await rm(directory, { recursive: true, force: true });
			}
		},
	);

	it('publishes imported snapshots, isolates them from mutations, and unsubscribes', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'shelf-ui-'));
		try {
			const catalogPath = join(directory, 'Catalog.json');
			const filepath = join(directory, 'book.pdf');
			await writeFile(
				catalogPath,
				JSON.stringify({
					lastUpdated: 1,
					manual: { overrides: {}, identifications: {}, includedFiles: [filepath] },
					data: {
						[filepath]: { filepath, title: 'Original title', author: 'An author' },
					},
				}),
			);
			const service = new LibraryService({
				catalogPath,
				settings: { watchedFolders: [] },
			} as unknown as DesktopLibrary);
			const listener = vi.fn();
			const unsubscribe = service.subscribe(listener);
			await service.importCatalog();
			expect(listener).toHaveBeenCalledOnce();
			const snapshot = service.books;
			expect(snapshot[0]?.title).toBe('Original title');
			expect(Object.isFrozen(snapshot[0])).toBe(true);
			expect(() => (snapshot as unknown[]).pop()).toThrow();
			expect(service.books).toHaveLength(1);
			unsubscribe();
			service.reportStatus('Scanning');
			expect(service.status).toBe('Scanning');
			expect(service.books).toBe(snapshot);
			expect(listener).toHaveBeenCalledOnce();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('keeps shared books visible throughout a refresh and reports inaccessible folders', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'shelf-ui-'));
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const catalogPath = join(directory, 'Catalog.json');
			const filepath = join(directory, 'shared', 'book.pdf');
			const missingFolder = join(directory, 'disconnected');
			await writeFile(
				catalogPath,
				JSON.stringify({
					lastUpdated: 1,
					manual: { overrides: {}, identifications: {}, includedFiles: [filepath] },
					data: {
						[filepath]: { filepath, title: 'Shared book', author: 'An author' },
					},
				}),
			);
			const service = new LibraryService({
				catalogPath,
				catalogDir: directory,
				settings: { watchedFolders: [missingFolder], onlineLookupEnabled: false },
			} as DesktopLibrary);
			await service.importCatalog();
			const counts: number[] = [];
			service.subscribe(() => counts.push(service.books.length));
			await service.updateCatalog();
			expect(counts.length).toBeGreaterThan(0);
			expect(counts.every((count) => count === 1)).toBe(true);
			expect(service.issues).toEqual([`Could not scan folder: ${missingFolder}`]);
			expect(service.status).toBe('Refresh finished with issues');
		} finally {
			errorLog.mockRestore();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('surfaces corrupt catalog imports rather than presenting a successful empty library', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'shelf-ui-'));
		try {
			const catalogPath = join(directory, 'Catalog.json');
			await writeFile(catalogPath, 'not json');
			const service = new LibraryService({
				catalogPath,
				settings: { watchedFolders: [] },
			} as unknown as DesktopLibrary);
			await expect(service.importCatalog()).rejects.toThrow();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
