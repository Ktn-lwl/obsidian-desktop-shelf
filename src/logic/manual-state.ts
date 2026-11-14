import { basename } from 'node:path';
import { Book, type BookProps, MetadataUpdateStatus } from './books/book';
import { bookIdentity, expandBooks, groupBooks } from './books/book-identity';
import type { CatalogFile, ManualState } from '../model/catalog';
import { assertISBN10, assertISBN13 } from '../model/isbn';

export function emptyManualState(): ManualState {
	return { overrides: {}, identifications: {}, includedFiles: [] };
}

export function parseManualISBN(input: string): ManualState['identifications'][string] {
	const isbn = input.replace(/[\s-]/g, '').toUpperCase();
	if (/^\d{9}[\dX]$/.test(isbn)) {
		assertISBN10(isbn);
		return { isbn10: isbn };
	}
	if (/^97[89]\d{10}$/.test(isbn)) {
		assertISBN13(isbn);
		return { isbn13: isbn };
	}
	throw new Error('Enter a valid ISBN-10 or ISBN-13.');
}

/** A manual identity always wins over a stale scan or another vault's old snapshot. */
export function applyIdentification(book: Book, manual: ManualState): Book {
	const identity = manual.identifications[book.Filepath];
	if (!identity) return book;
	const props = book.props;
	const corrected = { ...props, isbn10: undefined, isbn13: undefined, ...identity };
	if (bookIdentity(props) === bookIdentity(corrected)) return book;
	return new Book({
		filepath: props.filepath,
		title: basename(props.filepath),
		author: 'Unknown',
		...identity,
		metaDataStatus: MetadataUpdateStatus.PENDING,
		lastUpdateAttempt: props.lastUpdateAttempt,
	});
}

export function isIncluded(book: Readonly<BookProps>, manual: ManualState): boolean {
	return bookIdentity(book).startsWith('isbn:') || manual.includedFiles.includes(book.filepath);
}

export function catalogFiles(catalog: CatalogFile): Map<string, Book> {
	return expandBooks({ ...catalog.pendingFiles, ...catalog.data });
}

/** Migrate permissive catalogs without treating their unidentified entries as consent. */
export function normalizeCatalog(catalog: CatalogFile): void {
	const manual: ManualState = {
		overrides: catalog.manual?.overrides ?? {},
		identifications: catalog.manual?.identifications ?? {},
		includedFiles: catalog.manual?.includedFiles ?? [],
	};
	const included = new Map<string, Book>();
	const pending: Record<string, BookProps> = {};
	for (const [path, original] of catalogFiles(catalog)) {
		const book = applyIdentification(original, manual);
		if (isIncluded(book.props, manual)) included.set(path, book);
		else pending[path] = book.props;
	}
	catalog.manual = manual;
	catalog.data = Object.fromEntries(
		Array.from(groupBooks(included), ([key, book]) => [key, book.props]),
	);
	catalog.pendingFiles = pending;
}

export function displayBooks(
	catalog: Map<string, Book>,
	manual: ManualState,
	includePending = false,
): Readonly<BookProps>[] {
	const entries = [...catalog]
		.map(([path, book]) => [path, applyIdentification(book, manual)] as const)
		.filter(([, book]) => includePending || isIncluded(book.props, manual));
	return Array.from(groupBooks(entries), ([key, book]) =>
		Object.freeze({ ...book.props, ...manual.overrides[key] }),
	);
}
