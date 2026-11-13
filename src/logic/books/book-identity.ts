import { assertISBN10, assertISBN13 } from '../../model/isbn';
import { Book, type BookProps, MetadataUpdateStatus } from './book';

/** Normalize equivalent ISBN-10/13 identifiers to one ISBN-13 catalog key. */
export function bookIdentity(book: Readonly<BookProps>): string {
	const isbn13 = book.isbn13?.replace(/[\s-]/g, '');
	try {
		if (isbn13 && /^\d{13}$/.test(isbn13)) {
			assertISBN13(isbn13);
			return `isbn:${isbn13}`;
		}
	} catch {
		/* Try ISBN-10 before falling back to a path. */
	}
	const isbn10 = book.isbn10?.replace(/[\s-]/g, '').toUpperCase();
	try {
		if (isbn10 && /^\d{9}[\dX]$/.test(isbn10)) {
			assertISBN10(isbn10);
			const body = `978${isbn10.slice(0, 9)}`;
			const sum = [...body].reduce(
				(total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1),
				0,
			);
			return `isbn:${body}${(10 - (sum % 10)) % 10}`;
		}
	} catch {
		/* Invalid identifiers must not merge unrelated files. */
	}
	return book.filepath;
}

/** Paths remain indexed in memory for scanning; persistence and UI use ISBN records. */
export function groupBooks(entries: Iterable<readonly [string, Book]>): Map<string, Book> {
	const groups = new Map<string, { props: BookProps; paths: Set<string> }>();
	for (const [path, book] of entries) {
		const props = book.props;
		const key = bookIdentity(props);
		const group = groups.get(key);
		if (!group) {
			groups.set(key, { props, paths: new Set([path]) });
			continue;
		}
		group.paths.add(path);
		// A newly discovered copy must not replace already fetched metadata.
		const pending = (value: BookProps) => value.metaDataStatus === MetadataUpdateStatus.PENDING;
		if (
			(pending(group.props) && !pending(props)) ||
			(pending(group.props) === pending(props) &&
				(props.lastUpdateAttempt ?? 0) > (group.props.lastUpdateAttempt ?? 0))
		) {
			group.props = props;
		}
	}
	return new Map(
		[...groups].map(([key, group]) => {
			const paths = [...group.paths].sort();
			return [key, new Book({ ...group.props, filepath: paths[0]!, filepaths: paths })];
		}),
	);
}

/** Also accepts legacy catalogs keyed by individual file paths. */
export function expandBooks(records: Record<string, BookProps>): Map<string, Book> {
	const entries = new Map<string, Book>();
	for (const props of Object.values(records)) {
		for (const path of new Set([props.filepath, ...(props.filepaths ?? [])])) {
			const previous = entries.get(path);
			if (!previous || (props.lastUpdateAttempt ?? 0) > (previous.LastUpdated ?? 0)) {
				entries.set(path, new Book({ ...props, filepath: path, filepaths: undefined }));
			}
		}
	}
	return entries;
}
