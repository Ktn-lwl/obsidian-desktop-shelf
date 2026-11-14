import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type DesktopLibrary from '../../src/main';
import type { CatalogFile } from '../../src/model/catalog';
import { LibraryService } from '../../src/logic/LibraryService';
import { parseManualISBN } from '../../src/logic/manual-state';
vi.mock('../../src/logic/books/isbn-extractor', () => ({ discoverISBNs: vi.fn() }));
import { discoverISBNs } from '../../src/logic/books/isbn-extractor';

let directory: string;
let folder: string;
function plugin(): DesktopLibrary {
	return {
		catalogDir: directory,
		catalogPath: join(directory, 'Catalog.json'),
		settings: { watchedFolders: [folder], onlineLookupEnabled: false },
	} as unknown as DesktopLibrary;
}
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'shelf-scan-'));
	folder = join(directory, 'books');
	await mkdir(folder);
	vi.stubGlobal('window', { setTimeout, clearTimeout });
	vi.mocked(discoverISBNs).mockReset().mockResolvedValue({ ISBN10: null, ISBN13: null });
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	await rm(directory, { recursive: true, force: true });
});

describe('incremental library scans', () => {
	it('prunes missing fingerprints after a successful scan, preserving failed and unscanned folders', async () => {
		const archive = `${folder}-archive`;
		const offline = join(directory, 'offline');
		await mkdir(archive);
		await mkdir(offline);
		const identified = join(folder, 'identified.pdf');
		const pending = join(folder, 'pending.pdf');
		const archived = join(archive, 'archived.pdf');
		const disconnected = join(offline, 'disconnected.pdf');
		for (const path of [identified, pending, archived, disconnected])
			await writeFile(path, 'original');
		vi.mocked(discoverISBNs).mockImplementation(async (path) => ({
			ISBN10: null,
			ISBN13: path === identified ? parseManualISBN('9780132350884').isbn13! : null,
		}));
		const initialPlugin = plugin();
		initialPlugin.settings.watchedFolders = [folder, archive, offline];
		const initial = new LibraryService(initialPlugin);
		await initial.updateCatalog();
		const saved = JSON.parse(await readFile(plugin().catalogPath, 'utf8')) as CatalogFile;
		const orphan = join(folder, 'old-orphan.pdf');
		saved.scans![orphan] = { mtimeMs: 1, size: 1 };
		await writeFile(plugin().catalogPath, JSON.stringify(saved));
		await rm(identified);
		await rm(pending);
		await rm(offline, { recursive: true });
		const scannerPlugin = plugin();
		scannerPlugin.settings.watchedFolders = [folder, offline];
		const service = new LibraryService(scannerPlugin);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await service.updateCatalog();
		const after = JSON.parse(await readFile(plugin().catalogPath, 'utf8')) as CatalogFile;
		expect(after.scans).toEqual({
			[archived]: saved.scans![archived],
			[disconnected]: saved.scans![disconnected],
		});
		expect(after.data).toEqual({});
		expect(after.pendingFiles?.[pending]).toBeUndefined();
		// Adoption must prune memory too, or a later save would restore the removed fingerprints.
		await service.exportCatalog();
		const exported = JSON.parse(await readFile(plugin().catalogPath, 'utf8')) as CatalogFile;
		expect(exported.scans).toEqual(after.scans);
	});
	it('retains a fingerprint when its PDF was seen but could not be read', async () => {
		const path = join(folder, 'unreadable.pdf');
		await writeFile(path, 'unreadable');
		const fingerprint = { mtimeMs: 1, size: 1 };
		await writeFile(
			plugin().catalogPath,
			JSON.stringify({ lastUpdated: 1, data: {}, scans: { [path]: fingerprint } }),
		);
		vi.mocked(discoverISBNs).mockRejectedValueOnce(new Error('Permission denied'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const service = new LibraryService(plugin());
		await service.updateCatalog();
		const saved = JSON.parse(await readFile(plugin().catalogPath, 'utf8')) as CatalogFile;
		expect(saved.scans?.[path]).toEqual(fingerprint);
		expect(service.issues).toEqual([`Could not read PDF: ${path}`]);
	});

	it('keeps unidentified files outside the library and reuses cached results until the PDF changes', async () => {
		const path = join(folder, 'unidentified.pdf');
		await writeFile(path, 'first');
		const service = new LibraryService(plugin());
		await service.updateCatalog();
		expect(service.books).toHaveLength(0);
		expect(service.edits.candidates[0]?.title).toBe('unidentified.pdf');
		const saved = JSON.parse(await readFile(plugin().catalogPath, 'utf8')) as CatalogFile;
		expect(saved.data).toEqual({});
		expect(saved.pendingFiles?.[path]?.title).toBe('unidentified.pdf');
		expect(discoverISBNs).toHaveBeenCalledOnce();
		const reloaded = new LibraryService(plugin());
		await reloaded.importCatalog();
		await reloaded.updateCatalog();
		expect(discoverISBNs).toHaveBeenCalledOnce();
		await reloaded.edits.saveOverrides(path, { title: 'My unidentified title' });
		await writeFile(path, 'changed contents');
		vi.mocked(discoverISBNs).mockResolvedValueOnce({
			ISBN10: null,
			ISBN13: parseManualISBN('9780132350884').isbn13!,
		});
		await reloaded.updateCatalog();
		expect(discoverISBNs).toHaveBeenCalledTimes(2);
		expect(reloaded.books[0]?.isbn13).toBe('9780132350884');
		expect(reloaded.books[0]?.title).toBe('My unidentified title');
	});

	it('includes an unidentified file only after an explicit choice and persists that choice across scans', async () => {
		const path = join(folder, 'manual.pdf');
		await writeFile(path, 'first');
		const service = new LibraryService(plugin());
		await service.updateCatalog();
		expect(service.books).toHaveLength(0);
		await service.edits.setIncluded(path, true);
		expect(service.books[0]?.filepath).toBe(path);
		expect(service.edits.candidates).toHaveLength(0);
		const reloaded = new LibraryService(plugin());
		await reloaded.updateCatalog();
		expect(discoverISBNs).toHaveBeenCalledOnce();
		expect(reloaded.books[0]?.filepath).toBe(path);
		await reloaded.edits.setIncluded(path, false);
		await reloaded.updateCatalog();
		expect(reloaded.books).toHaveLength(0);
		expect(reloaded.edits.candidates[0]?.filepath).toBe(path);
		expect(discoverISBNs).toHaveBeenCalledOnce();
	});
	it('includes a file when an ISBN is assigned and preserves it when the PDF changes', async () => {
		const path = join(folder, 'manual.pdf');
		await writeFile(path, 'initial');
		const service = new LibraryService(plugin());
		await service.updateCatalog();
		expect(service.books).toHaveLength(0);
		await service.edits.assignISBN(path, '9780132350884');
		expect(service.books[0]?.isbn13).toBe('9780132350884');
		await service.edits.saveOverrides('isbn:9780132350884', { title: 'Manual title' });
		await writeFile(path, 'updated PDF');
		await service.updateCatalog();
		expect(discoverISBNs).toHaveBeenCalledOnce();
		expect(service.books[0]).toMatchObject({ title: 'Manual title', isbn13: '9780132350884' });
	});

	it('queues edits during refresh so a slow scan cannot overwrite them', async () => {
		const path = join(folder, 'slow.pdf');
		await writeFile(path, 'initial');
		let finish!: () => void;
		const waiting = new Promise<void>((resolve) => {
			finish = resolve;
		});
		let entered!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		vi.mocked(discoverISBNs).mockImplementationOnce(async () => {
			entered();
			await waiting;
			return { ISBN10: null, ISBN13: null };
		});
		const service = new LibraryService(plugin());
		const refresh = service.updateCatalog();
		await started;
		const save = service.edits.setIncluded(path, true);
		finish();
		await Promise.all([refresh, save]);
		expect(service.books[0]?.filepath).toBe(path);
		expect(service.edits.candidates).toHaveLength(0);
	});
});
