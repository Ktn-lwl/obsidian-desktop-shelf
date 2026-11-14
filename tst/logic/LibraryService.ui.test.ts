import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type DesktopLibrary from '../../src/main';
import { LibraryService } from '../../src/logic/LibraryService';

describe('LibraryService view integration', () => {
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
			const service = new LibraryService({ catalogPath } as DesktopLibrary);
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
			const service = new LibraryService({ catalogPath } as DesktopLibrary);
			await expect(service.importCatalog()).rejects.toThrow();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
