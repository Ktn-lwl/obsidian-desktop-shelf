import MyPlugin from '../main';
import { createBook, getPDFPaths } from './books/directory-crawler';
import { Book, MetadataUpdateStatus } from './books/book';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { CatalogFile } from '../model';
import { EgressClient } from './network';
import { NotFoundError } from '../model/errors';
import { isAbsolute, relative, sep } from 'node:path';

export class LibraryService {
	private readonly plugin: MyPlugin;
	private catalog: Map<string, Book> = new Map();
	private lastUpdated = 0;
	private client: EgressClient;

	constructor(plugin: MyPlugin) {
		this.plugin = plugin;
		this.client = new EgressClient(plugin);
	}

	async updateCatalog(): Promise<void> {
		const updatedCatalog = new Map<string, Book>();

		for (const folder of this.plugin.settings.watchedFolders) {
			const folderCatalog = new Map<string, Book>();
			try {
				for await (const filepath of getPDFPaths(folder)) {
					try {
						const book = this.catalog.get(filepath) ?? (await createBook(filepath));

						if (book === null) {
							continue;
						}

						folderCatalog.set(filepath, book);
					} catch (error) {
						console.error(`Failed to process PDF: ${filepath}`, error);
					}
				}
				for (const [filepath, book] of folderCatalog) {
					updatedCatalog.set(filepath, book);
				}
			} catch (error) {
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

		this.catalog = updatedCatalog;
		this.lastUpdated = Date.now();

		for (const book of this.pendingBooks()) {
			try {
				await this.updateBook(book);
			} catch (err) {
				console.error(`Failed to update metadata for ${book.Filepath}: `, err);
			}
		}
		await this.exportCatalog();
	}

	async exportCatalog(): Promise<void> {
		const payload: CatalogFile = {
			lastUpdated: this.lastUpdated,
			data: Object.fromEntries(
				Array.from(this.catalog, ([filepath, book]) => [filepath, book.props]),
			),
		};

		await mkdir(this.plugin.catalogDir, { recursive: true });

		// write to a temp file, then rename, so a crash mid-write can't corrupt Catalog.json
		const tmp = `${this.plugin.catalogPath}.tmp`;
		await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf-8');
		await rename(tmp, this.plugin.catalogPath);
	}

	async importCatalog(): Promise<void> {
		try {
			const raw = await readFile(this.plugin.catalogPath, 'utf-8');
			const parsed = JSON.parse(raw) as CatalogFile;
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

	async updateBook(book: Book): Promise<void> {
		const isbn = book.ISBN13 ?? book.ISBN10;
		if (!isbn) return; // stays PENDING

		try {
			const image = await this.client.downloadImage(isbn);
			const metadata = await this.client.fetchMetadata(isbn);
			if (metadata === undefined) {
				throw new Error(`No metadata was retrieved for ISBN ${isbn}`);
			}

			if (image !== undefined) book.CoverImgSrc = image;
			book.MetaDataUpdateStatus = MetadataUpdateStatus.SUCCESS;
			book.LastUpdateAttempt = Date.now();
		} catch (error) {
			console.error(`Failed to update metadata for ISBN ${isbn}`, error);
			book.MetaDataUpdateStatus =
				error instanceof NotFoundError
					? MetadataUpdateStatus.MISSING // permanent, don't retry
					: MetadataUpdateStatus.FAILED; // transient, retry later
			book.LastUpdateAttempt = Date.now();
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
