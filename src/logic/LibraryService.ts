import MyPlugin from '../main';
import { createBook, getPDFPaths } from './books/directory-crawler';
import { Book, MetadataUpdateStatus } from './books/book';
import { mkdir, open, writeFile, readFile, rename, unlink } from 'node:fs/promises';
import { CatalogFile } from '../model';
import { EgressClient } from './network';
import { isAbsolute, relative, sep } from 'node:path';
import { delay, throwIfAborted } from '../utils/cancellation';

const CATALOG_LOCK_TIMEOUT_MS = 15_000;
const CATALOG_LOCK_RETRY_MS = 100;
let temporaryFileCounter = 0;

export class LibraryService {
	private readonly plugin: MyPlugin;
	private catalog: Map<string, Book> = new Map();
	private lastUpdated = 0;
	private client: EgressClient;

	constructor(plugin: MyPlugin) {
		this.plugin = plugin;
		this.client = new EgressClient(plugin);
	}

	async updateCatalog(signal?: AbortSignal): Promise<void> {
		throwIfAborted(signal);
		const updatedCatalog = new Map<string, Book>();
		const successfullyScannedFolders: string[] = [];

		for (const folder of this.plugin.settings.watchedFolders) {
			throwIfAborted(signal);
			const folderCatalog = new Map<string, Book>();
			try {
				for await (const filepath of getPDFPaths(folder, signal)) {
					throwIfAborted(signal);
					try {
						const book =
							this.catalog.get(filepath) ?? (await createBook(filepath, signal));

						if (book === null) {
							continue;
						}

						throwIfAborted(signal);
						folderCatalog.set(filepath, book);
					} catch (error) {
						throwIfAborted(signal);
						console.error(`Failed to process PDF: ${filepath}`, error);
					}
				}
				for (const [filepath, book] of folderCatalog) {
					updatedCatalog.set(filepath, book);
				}
				successfullyScannedFolders.push(folder);
			} catch (error) {
				throwIfAborted(signal);
				console.error(`Failed to scan watched folder: ${folder}`, error);
				for (const [filepath, book] of this.catalog) {
					const pathFromFolder = relative(folder, filepath);
					if (
						pathFromFolder &&
						pathFromFolder !== '..' &&
						!pathFromFolder.startsWith(`..${sep}`) &&
						!isAbsolute(pathFromFolder)
					) {
						updatedCatalog.set(filepath, book);
					}
				}
			}
		}

		throwIfAborted(signal);
		this.catalog = updatedCatalog;
		this.lastUpdated = Date.now();

		for (const book of this.pendingBooks()) {
			try {
				throwIfAborted(signal);
				await this.updateBook(book, signal);
			} catch (err) {
				throwIfAborted(signal);
				console.error(`Failed to update metadata for ${book.Filepath}: `, err);
			}
		}
		throwIfAborted(signal);
		await this.exportCatalog(successfullyScannedFolders, signal);
	}

	async exportCatalog(
		successfullyScannedFolders: string[] = [],
		signal?: AbortSignal,
	): Promise<void> {
		throwIfAborted(signal);
		await mkdir(this.plugin.catalogDir, { recursive: true });

		await this.withCatalogLock(async () => {
			throwIfAborted(signal);
			const diskCatalog = await this.readCatalogFromDisk();
			throwIfAborted(signal);
			const mergedCatalog = new Map<string, Book>();
			const diskBooks = new Map(
				Object.entries(diskCatalog?.data ?? {}).map(([filepath, record]) => [
					filepath,
					new Book(record),
				]),
			);

			for (const [filepath, book] of diskBooks) {
				if (
					!successfullyScannedFolders.some((folder) =>
						isPathWithinFolder(folder, filepath),
					)
				) {
					mergedCatalog.set(filepath, book);
				}
			}

			for (const [filepath, book] of this.catalog) {
				const diskBook = diskBooks.get(filepath);
				mergedCatalog.set(
					filepath,
					!diskBook || (book.LastUpdated ?? 0) > (diskBook.LastUpdated ?? 0)
						? book
						: diskBook,
				);
			}

			const lastUpdated = Math.max(Date.now(), (diskCatalog?.lastUpdated ?? 0) + 1);
			const payload: CatalogFile = {
				lastUpdated,
				data: Object.fromEntries(
					Array.from(mergedCatalog, ([filepath, book]) => [filepath, book.props]),
				),
			};
			const tmp = `${this.plugin.catalogPath}.${process.pid}.${Date.now()}.${temporaryFileCounter++}.tmp`;
			try {
				throwIfAborted(signal);
				await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf-8');
				throwIfAborted(signal);
				await rename(tmp, this.plugin.catalogPath);
			} catch (error) {
				await unlink(tmp).catch((cleanupError: NodeJS.ErrnoException) => {
					if (cleanupError.code !== 'ENOENT') throw cleanupError;
				});
				throw error;
			}

			this.catalog = mergedCatalog;
			this.lastUpdated = lastUpdated;
		}, signal);
	}

	async importCatalog(): Promise<void> {
		try {
			const parsed = await this.readCatalogFromDisk();
			if (!parsed) return;
			this.lastUpdated = parsed.lastUpdated;
			this.catalog = new Map(
				Object.entries(parsed.data).map(([filepath, record]) => [
					filepath,
					new Book(record),
				]),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				console.error('Failed to read catalog, starting fresh', error);
			}
		}
	}

	private async readCatalogFromDisk(): Promise<CatalogFile | undefined> {
		let raw: string;
		try {
			raw = await readFile(this.plugin.catalogPath, 'utf-8');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
			throw error;
		}

		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			typeof (parsed as CatalogFile).lastUpdated !== 'number' ||
			typeof (parsed as CatalogFile).data !== 'object' ||
			(parsed as CatalogFile).data === null ||
			Array.isArray((parsed as CatalogFile).data)
		) {
			throw new Error(`Catalog has an invalid format: ${this.plugin.catalogPath}`);
		}
		return parsed as CatalogFile;
	}

	private async withCatalogLock<T>(
		operation: () => Promise<T>,
		signal?: AbortSignal,
	): Promise<T> {
		const lockPath = `${this.plugin.catalogPath}.lock`;
		const deadline = Date.now() + CATALOG_LOCK_TIMEOUT_MS;
		let lockHandle: Awaited<ReturnType<typeof open>> | undefined;

		while (!lockHandle) {
			throwIfAborted(signal);
			let candidate;
			try {
				candidate = await open(lockPath, 'wx');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
				if (Date.now() >= deadline) {
					throw new Error(
						`Timed out waiting for the catalog lock at ${lockPath}. If no plugin process is using the catalog, remove this stale lock file and retry.`,
					);
				}
				await delay(CATALOG_LOCK_RETRY_MS, signal);
				continue;
			}

			try {
				await candidate.writeFile(
					JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }),
					'utf-8',
				);
				lockHandle = candidate;
			} catch (error) {
				await candidate.close();
				await unlink(lockPath);
				throw error;
			}
		}

		try {
			return await operation();
		} finally {
			try {
				await lockHandle.close();
			} finally {
				await unlink(lockPath);
			}
		}
	}

	async updateBook(book: Book, signal?: AbortSignal): Promise<void> {
		throwIfAborted(signal);
		if (this.plugin.settings.onlineLookupEnabled !== true) return;
		const isbn = book.ISBN13 ?? book.ISBN10;
		if (!isbn) return; // stays PENDING

		book.LastUpdateAttempt = Date.now();
		let metadataApplied = false;

		try {
			const metadata = await this.client.fetchMetadata(isbn, signal);
			throwIfAborted(signal);
			if (metadata === undefined) {
				book.MetaDataUpdateStatus = MetadataUpdateStatus.MISSING;
				return;
			}

			book.update(metadata);
			metadataApplied = true;

			if (metadata.coverUrl) {
				const image = await this.client.downloadImage(metadata.coverUrl, isbn, signal);
				throwIfAborted(signal);
				if (image) book.CoverImgSrc = image;
			}

			book.MetaDataUpdateStatus = MetadataUpdateStatus.SUCCESS;
		} catch (error) {
			throwIfAborted(signal);
			console.error(`Failed to update metadata for ISBN ${isbn}`, error);
			book.MetaDataUpdateStatus = metadataApplied
				? MetadataUpdateStatus.PARTIAL
				: MetadataUpdateStatus.FAILED;
		}
	}

	isStale(maxAgeMs = 2 * 24 * 60 * 60 * 1000): boolean {
		return Date.now() - this.lastUpdated > maxAgeMs;
	}

	private *pendingBooks(): Generator<Book> {
		for (const book of this.catalog.values()) {
			if (book.canUpdate) {
				yield book;
			}
		}
	}
}

function isPathWithinFolder(folder: string, filepath: string): boolean {
	const pathFromFolder = relative(folder, filepath);
	return (
		pathFromFolder !== '..' &&
		!pathFromFolder.startsWith(`..${sep}`) &&
		!isAbsolute(pathFromFolder)
	);
}
