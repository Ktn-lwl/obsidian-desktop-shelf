import { basename, isAbsolute } from 'node:path';
import type { BookProps } from './books/book';
import { Book } from './books/book';
import { bookIdentity, groupBooks } from './books/book-identity';
import type { CatalogFile, ManualState, MetadataOverrides } from '../model/catalog';
import { catalogFiles, emptyManualState, isIncluded, parseManualISBN } from './manual-state';

export interface EditHost {
	transaction(change: (catalog: CatalogFile) => void): Promise<void>;
	books(): ReadonlyArray<Readonly<BookProps>>;
	baseBook(path: string): BookProps | undefined;
	manual(): ManualState;
}

export class ISBNMergeRequiredError extends Error {
	constructor(readonly book: Readonly<BookProps>) {
		super('This ISBN already exists. Review the merge preview and save again.');
	}
}

/** Edit transactions patch only requested fields in the latest on-disk state. */
export class LibraryEdits {
	private lastFiles?: ReadonlyArray<Readonly<BookProps>>;
	private pending: ReadonlyArray<Readonly<BookProps>> = [];
	constructor(private readonly host: EditHost) {}
	get candidates(): ReadonlyArray<Readonly<BookProps>> {
		const files = this.host.books();
		if (files !== this.lastFiles) {
			this.lastFiles = files;
			this.pending = Object.freeze(
				files
					.filter((book) => !isIncluded(book, this.host.manual()))
					.sort((a, b) => a.filepath.localeCompare(b.filepath)),
			);
		}
		return this.pending;
	}

	getOverrides(identity: string): MetadataOverrides {
		return { ...this.host.manual().overrides[identity] };
	}
	getBaseBook(path: string): BookProps | undefined {
		return this.host.baseBook(path);
	}
	previewISBN(path: string, input: string): Readonly<BookProps> | undefined {
		const isbn = parseManualISBN(input);
		const key = bookIdentity({ filepath: path, ...isbn });
		return this.host
			.books()
			.find(
				(book) =>
					bookIdentity(book) === key &&
					!book.filepaths?.includes(path) &&
					book.filepath !== path,
			);
	}
	async saveOverrides(
		identity: string,
		patch: Partial<Record<keyof MetadataOverrides, string | number | null>>,
	): Promise<void> {
		const validated: Partial<Record<keyof MetadataOverrides, string | number | null>> = {};
		for (const field of ['title', 'author', 'publisher', 'year'] as const) {
			const value = patch[field];
			if (value === undefined) continue;
			if (value === null) {
				validated[field] = null;
				continue;
			}
			if (field === 'year') {
				if (
					typeof value !== 'number' ||
					!Number.isInteger(value) ||
					value < 1 ||
					value > 9999
				)
					throw new Error('Enter a year from 1 to 9999.');
				validated.year = value;
			} else {
				if (
					typeof value !== 'string' ||
					((field === 'title' || field === 'author') && !value.trim())
				)
					throw new Error(`${field === 'title' ? 'Title' : 'Author'} cannot be empty.`);
				validated[field] = value.trim();
			}
		}
		await this.host.transaction((catalog) => {
			if (!groupBooks(catalogFiles(catalog)).has(identity)) {
				throw new Error('This entry has changed. Reopen its details and try again.');
			}
			const manual = (catalog.manual ??= emptyManualState());
			const overrides = { ...manual.overrides[identity] };
			for (const field of ['title', 'author', 'publisher', 'year'] as const) {
				const value = validated[field];
				if (value === null) delete overrides[field];
				else if (value !== undefined) Object.assign(overrides, { [field]: value });
			}
			manual.overrides[identity] = overrides;
		});
	}
	async assignISBN(path: string, input: string, expectedMerge?: string): Promise<void> {
		const isbn = parseManualISBN(input);
		const targetKey = bookIdentity({ filepath: path, ...isbn });
		await this.host.transaction((catalog) => {
			const manual = (catalog.manual ??= emptyManualState());
			const books = catalogFiles(catalog);
			const previous = books.get(path);
			if (!previous)
				throw new Error('This file is no longer in the library. Refresh and try again.');
			const groups = groupBooks(books);
			const existing = groups.get(targetKey);
			const oldKey = bookIdentity(previous.props);
			const sameIdentity = oldKey === targetKey;
			if (
				!sameIdentity &&
				existing &&
				(existing.props.filepaths ?? [existing.Filepath]).some((copy) => copy !== path) &&
				expectedMerge !== targetKey
			) {
				throw new ISBNMergeRequiredError({
					...existing.props,
					...manual.overrides[targetKey],
				});
			}
			// A different edition starts with that edition's metadata, never the old edition's.
			const source =
				existing?.props ??
				(sameIdentity
					? previous.props
					: {
							filepath: path,
							title: basename(path),
							author: 'Unknown',
						});
			books.set(
				path,
				new Book({
					...source,
					filepath: path,
					filepaths: undefined,
					isbn10: undefined,
					isbn13: undefined,
					...isbn,
				}),
			);
			manual.identifications[path] = isbn;
			// Unidentified entries carry their own manual details into the new ISBN record.
			if (oldKey === path && manual.overrides[oldKey]) {
				manual.overrides[targetKey] = {
					...manual.overrides[oldKey],
					...manual.overrides[targetKey],
				};
				delete manual.overrides[oldKey];
			}
			catalog.pendingFiles = {};
			catalog.data = Object.fromEntries(
				Array.from(groupBooks(books), ([key, book]) => [key, book.props]),
			);
		});
	}
	async setIncluded(path: string, included: boolean): Promise<void> {
		if (!isAbsolute(path)) throw new Error('Select an absolute file path.');
		await this.host.transaction((catalog) => {
			const manual = (catalog.manual ??= emptyManualState());
			const book = catalogFiles(catalog).get(path);
			if (!book) throw new Error('This file is no longer available. Refresh and try again.');
			if (!included && bookIdentity(book.props).startsWith('isbn:'))
				throw new Error('Books with a valid ISBN are included automatically.');
			const paths = new Set(manual.includedFiles);
			if (included) paths.add(path);
			else paths.delete(path);
			manual.includedFiles = [...paths].sort();
		});
	}
}
