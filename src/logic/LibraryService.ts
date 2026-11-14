import type MyPlugin from '../main';
import { Book, type BookProps, MetadataUpdateStatus } from './books/book';
import { CatalogFile } from '../model';
import { EgressClient } from './network';
import { scanLibrary, isPathWithinFolder } from './scan-library';
import { throwIfAborted } from '../utils/cancellation';
import { bookIdentity, groupBooks } from './books/book-identity';
import { CatalogStore } from './catalog-store';
import { LibraryEdits, type EditHost } from './library-edits';
import { applyIdentification, catalogFiles, displayBooks, emptyManualState } from './manual-state';

export class LibraryService {
	private readonly plugin: MyPlugin;
	private catalog: Map<string, Book> = new Map();
	private lastUpdated = 0;
	private client: EgressClient;
	private listeners = new Set<() => void>();
	private message = 'Ready';
	private problems: string[] = [];
	private store: CatalogStore;
	readonly edits: LibraryEdits;
	private manual = emptyManualState();
	private scans: NonNullable<CatalogFile['scans']> = {};
	private operation: Promise<unknown> = Promise.resolve();
	private snapshot?: ReadonlyArray<Readonly<BookProps>>;
	private filesSnapshot?: ReadonlyArray<Readonly<BookProps>>;

	get books(): ReadonlyArray<Readonly<BookProps>> {
		return (this.snapshot ??= Object.freeze(displayBooks(this.catalog, this.manual)));
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
		if (catalogChanged) {
			this.snapshot = undefined;
			this.filesSnapshot = undefined;
		}
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
		this.store = new CatalogStore(plugin);
		const host: EditHost = {
			transaction: (change) =>
				this.enqueue(async () => {
					const saved = await this.store.update((catalog) => change(catalog));
					this.adopt(saved);
				}),
			books: () =>
				(this.filesSnapshot ??= Object.freeze(
					displayBooks(this.catalog, this.manual, true),
				)),
			baseBook: (path) => this.catalog.get(path)?.props,
			manual: () => this.manual,
		};
		this.edits = new LibraryEdits(host);
	}

	private enqueue<T>(work: () => Promise<T>): Promise<T> {
		const result = this.operation.then(work);
		this.operation = result.catch(() => {});
		return result;
	}
	private adopt(catalog: CatalogFile): void {
		this.catalog = catalogFiles(catalog);
		this.manual = catalog.manual ?? emptyManualState();
		this.scans = catalog.scans ?? {};
		this.lastUpdated = catalog.lastUpdated;
		this.notify(true);
	}

	updateCatalog(signal?: AbortSignal): Promise<void> {
		return this.enqueue(() => this.scanCatalog(signal));
	}
	private async scanCatalog(signal?: AbortSignal): Promise<void> {
		throwIfAborted(signal);
		const latest = await this.store.read();
		if (latest) this.adopt(latest);
		this.problems = [];
		this.reportStatus('Scanning folders…');
		const scan = await scanLibrary(
			this.catalog,
			this.manual,
			this.scans,
			this.plugin.settings.watchedFolders,
			(message) => this.reportStatus(message),
			signal,
		);
		this.problems = scan.problems;
		const successfullyScannedFolders = scan.successfullyScannedFolders;
		const updatedCatalog = scan.books;
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
		await this.saveCatalog(successfullyScannedFolders, signal, scan.observedPaths);
		this.reportStatus(
			this.problems.length ? 'Refresh finished with issues' : 'Library up to date',
		);
	}

	exportCatalog(folders: string[] = [], signal?: AbortSignal): Promise<void> {
		return this.enqueue(() => this.saveCatalog(folders, signal));
	}
	private async saveCatalog(
		folders: string[],
		signal?: AbortSignal,
		observedPaths: ReadonlySet<string> = new Set(this.catalog.keys()),
	): Promise<void> {
		const saved = await this.store.update((disk) => {
			const manual = disk.manual ?? this.manual;
			const diskBooks = catalogFiles(disk);
			const merged = new Map<string, Book>();
			for (const [path, book] of diskBooks) {
				if (!folders.some((folder) => isPathWithinFolder(folder, path)))
					merged.set(path, applyIdentification(book, manual));
			}
			for (const [path, book] of this.catalog) {
				const local = applyIdentification(book, manual);
				const other = diskBooks.get(path);
				const current = other && applyIdentification(other, manual);
				const correctedOnDisk =
					manual.identifications[path] &&
					bookIdentity(book.props) !== bookIdentity(local.props);
				merged.set(
					path,
					current && correctedOnDisk
						? current
						: !current || (local.LastUpdated ?? 0) > (current.LastUpdated ?? 0)
							? local
							: current,
				);
			}
			for (const [path, book] of merged) {
				const identity = bookIdentity(book.props);
				if (identity !== path && manual.overrides[path]) {
					manual.overrides[identity] = {
						...manual.overrides[path],
						...manual.overrides[identity],
					};
					delete manual.overrides[path];
				}
			}
			disk.pendingFiles = {};
			disk.data = Object.fromEntries(
				Array.from(groupBooks(merged), ([key, book]) => [key, book.props]),
			);
			disk.manual = manual;
			disk.scans = { ...disk.scans, ...this.scans };
			// Prune after merging so stale disk fingerprints cannot be reintroduced.
			// A failed PDF read still counts as observed; only a complete folder scan proves absence.
			for (const path of Object.keys(disk.scans)) {
				if (
					!observedPaths.has(path) &&
					folders.some((folder) => isPathWithinFolder(folder, path))
				) {
					delete disk.scans[path];
				}
			}
		}, signal);
		this.adopt(saved);
	}
	importCatalog(): Promise<void> {
		return this.enqueue(async () => {
			const saved = await this.store.read();
			if (saved) this.adopt(saved);
		});
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
			if (book.canUpdate && book.hasISBN()) {
				yield book;
			}
		}
	}
}
