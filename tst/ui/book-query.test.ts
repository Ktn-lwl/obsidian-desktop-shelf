import { describe, expect, it } from 'vitest';
import { selectBooks } from '../../src/ui/book-query';
import type { BookProps } from '../../src/logic/books/book';
import { assertISBN13 } from '../../src/model/isbn';

const isbn = '9780132350884';
assertISBN13(isbn);
const books: BookProps[] = [
	{
		filepath: '/books/clean-code.pdf',
		title: 'Clean code',
		author: 'Robert Martin',
		isbn13: isbn,
	},
	{ filepath: '/books/algebra.pdf', title: 'Algebra 10', author: 'Ada' },
	{ filepath: '/books/algebra-2.pdf', title: 'Algebra 2', author: 'Zoe' },
];

describe('shelf search and sorting', () => {
	it('matches terms across title and author regardless of case or whitespace', () => {
		expect(selectBooks(books, '  CLEAN martin ', 'title')).toEqual([books[0]]);
	});
	it('finds ISBNs and local filenames', () => {
		expect(selectBooks(books, isbn, 'title')).toEqual([books[0]]);
		expect(selectBooks(books, 'algebra-2.pdf', 'title')).toEqual([books[2]]);
	});
	it('uses natural title ordering without changing the catalog order', () => {
		expect(selectBooks(books, '', 'title').map((b) => b.title)).toEqual([
			'Algebra 2',
			'Algebra 10',
			'Clean code',
		]);
		expect(books[0]?.title).toBe('Clean code');
	});
	it('sorts by author and handles unmatched queries', () => {
		expect(selectBooks(books, '', 'author').map((b) => b.author)).toEqual([
			'Ada',
			'Robert Martin',
			'Zoe',
		]);
		expect(selectBooks(books, 'missing title', 'title')).toEqual([]);
	});
});
