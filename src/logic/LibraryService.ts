import type MyPlugin from '../main';
import { createBook, getPDFPaths } from './books/directory-crawler';
import { Book, type BookProps, MetadataUpdateStatus } from './books/book';
import { mkdir, open, writeFile, readFile, rename, unlink } from 'node:fs/promises';
import { CatalogFile } from '../model';
import { EgressClient } from './network';
import { isAbsolute, relative, sep } from 'node:path';
import { delay, throwIfAborted } from '../utils/cancellation';
import { expandBooks, groupBooks } from './books/book-identity';

const CATALOG_LOCK_TIMEOUT_MS = 15_000;
const CATALOG_LOCK_RETRY_MS = 100;
let temporaryFileCounter = 0;

export class LibraryService {
	private readonly plugin: MyPlugin;
	private catalog: Map<string, Book> = new Map();
	private lastUpdated = 0;
	private client: EgressClient;
	private listeners = new Set<() => void>();
	private message = 'Ready';
	private problems: string[] = [];
	private snapshot?: ReadonlyArray<Readonly<BookProps>>;

	get books(): ReadonlyArray<Readonly<BookProps>> {
		return (this.snapshot ??= Object.freeze(
			Array.from(groupBooks(this.catalog).values(), (book) => Object.freeze(book.props)),
		));
	}

	get status(): string {
		return this.message;
	}
	get issues(): readonly string[] {
		return [...this.problems];
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	reportStatus(message: string): void {
		this.message = message;
		this.notify();
	}

	private notify(catalogChanged = false): void {
		if (catalogChanged) this.snapshot = undefined;
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (error) {
				console.error('Library listener failed', error);
			}
		}
	}

	constructor(plugin: MyPlugin) {
		this.plugin = plugin;
		this.client = new EgressClient(plugin);
	}

	async updateCatalog(signal?: AbortSignal): Promise<void> {
		throwIfAborted(signal);
		this.problems = [];
		this.reportStatus('Scanning folders…');
		let discovered = 0;
		const updatedCatalog = new Map<string, Book>();
		const successfullyScannedFolders: string[] = [];

		for (const folder of this.plugin.settings.watchedFolders) {
			throwIfAborted(signal);
			const folderCatalog = new Map<string, Book>();
			try {
				for await (const filepath of getPDFPaths(folder, signal)) {
					throwIfAborted(signal);
					this.reportStatus(`Scanning PDFs · ${++discovered} found`);
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
						this.problems.push(`Could not read PDF: ${filepath}`);
						console.error(`Failed to process PDF: ${filepath}`, error);
					}
				}
				for (const [filepath, book] of folderCatalog) {
					updatedCatalog.set(filepath, book);
				}
				successfullyScannedFolders.push(folder);
			} catch (error) {
				throwIfAborted(signal);
				this.problems.push(`Could not scan folder: ${folder}`);
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
		// Keep shared books visible while local metadata is refreshed.
		for (const [filepath, book] of this.catalog) {
			if (
				!successfullyScannedFolders.some((folder) => isPathWithinFolder(folder, filepath))
			) {
				updatedCatalog.set(filepath, book);
			}
		}
		this.catalog = updatedCatalog;
		this.notify(true);
		this.lastUpdated = Date.now();

		const pending = Array.from(this.pendingBooks());
		let completed = 0;
		for (const book of pending) {
			if (this.plugin.settings.onlineLookupEnabled) {
				this.reportStatus(`Looking up books · ${++completed} of ${pending.length}`);
			}
			try {
				throwIfAborted(signal);
				await this.updateBook(book, signal);
				for (const filepath of book.props.filepaths ?? [book.Filepath]) {
					this.catalog.set(
						filepath,
						new Book({ ...book.props, filepath, filepaths: undefined }),
					);
				}
				if (
					this.plugin.settings.onlineLookupEnabled &&
					(book.props.metaDataStatus === MetadataUpdateStatus.FAILED ||
						book.props.metaDataStatus === MetadataUpdateStatus.PARTIAL)
				) {
					this.problems.push(`Could not finish online lookup: ${book.Title}`);
				}
				if (this.plugin.settings.onlineLookupEnabled) this.notify(true);
			} catch (err) {
				throwIfAborted(signal);
				this.problems.push(`Could not finish online lookup: ${book.Title}`);
				console.error(`Failed to update metadata for ${book.Filepath}: `, err);
			}
		}
		throwIfAborted(signal);
		this.reportStatus('Saving library…');
		await this.exportCatalog(successfullyScannedFolders, signal);
		this.reportStatus(
			this.problems.length ? 'Refresh finished with issues' : 'Library up to date',
		);
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
			const diskBooks = expandBooks(diskCatalog?.data ?? {});

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
					Array.from(groupBooks(mergedCatalog), ([identity, book]) => [
						identity,
						book.props,
					]),
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

			this.catalog = expandBooks(payload.data);
			this.lastUpdated = lastUpdated;
			this.notify(true);
		}, signal);
	}

	async importCatalog(): Promise<void> {
		try {
			const parsed = await this.readCatalogFromDisk();
			if (!parsed) return;
			this.lastUpdated = parsed.lastUpdated;
			this.catalog = expandBooks(parsed.data);
			this.notify(true);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
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
		for (const book of groupBooks(this.catalog).values()) {
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
