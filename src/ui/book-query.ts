import type { BookProps } from '../logic/books/book';

export type BookSort = 'title' | 'author';

export function selectBooks(
	books: ReadonlyArray<Readonly<BookProps>>,
	query: string,
	sort: BookSort,
): Readonly<BookProps>[] {
	const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
	return books
		.filter((book) => {
			const searchable = [book.title, book.author, book.isbn10, book.isbn13, book.filepath]
				.join(' ')
				.toLocaleLowerCase();
			return terms.every((term) => searchable.includes(term));
		})
		.sort(
			(a, b) =>
				a[sort].localeCompare(b[sort], undefined, { numeric: true, sensitivity: 'base' }) ||
				a.title.localeCompare(b.title) ||
				a.filepath.localeCompare(b.filepath),
		);
}
