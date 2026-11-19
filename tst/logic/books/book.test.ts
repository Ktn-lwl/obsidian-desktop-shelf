import { describe, expect, it } from 'vitest';
import { Book, BookProps, MetadataUpdateStatus } from '../../../src/logic/books/book';

describe('Book catalog records', () => {
	it('isolates stored metadata and file paths from inputs and snapshots', () => {
		const filepaths = ['/books/example.pdf'];
		const props: BookProps = {
			filepath: filepaths[0]!,
			filepaths,
			title: 'Example',
			author: 'Unknown',
		};
		const book = new Book(props);

		props.title = 'Changed input';
		filepaths.push('/books/another.pdf');
		const snapshot = book.props;
		snapshot.title = 'Changed snapshot';

		expect(book.props.title).toBe('Example');
		expect(book.props.filepaths).toEqual(['/books/example.pdf']);
		expect(Object.isFrozen(snapshot.filepaths)).toBe(true);

		book.update({ title: 'Updated book', authors: [] });
		expect(snapshot.title).toBe('Changed snapshot');
		expect(book.props.title).toBe('Updated book');
	});

	it('rehydrates metadata status and last-attempt time from JSON', () => {
		const props: BookProps = {
			filepath: '/books/example.pdf',
			title: 'Example',
			author: 'Unknown',
			metaDataStatus: MetadataUpdateStatus.FAILED,
			lastUpdateAttempt: 1234,
		};

		const book = new Book(JSON.parse(JSON.stringify(props)) as BookProps);

		expect(book.canUpdate).toBe(true);
		expect(book.LastUpdated).toBe(1234);
	});

	it('defaults older catalog records to pending', () => {
		const book = new Book({
			filepath: '/books/example.pdf',
			title: 'Example',
			author: 'Unknown',
		});

		expect(book.canUpdate).toBe(true);
	});

	it('applies metadata without corrupting an existing year when the date is absent', () => {
		const book = new Book({
			filepath: '/books/example.pdf',
			title: 'Filename',
			author: 'Unknown',
			year: 2020,
		});

		book.update({
			title: 'Catalog title',
			authors: ['Ada Lovelace', 'Grace Hopper'],
			publishedDate: '2019-05',
		});

		expect(book.Title).toBe('Catalog title');
		expect(book.Author).toBe('Ada Lovelace, Grace Hopper');
		expect(book.Year).toBe(2019);
	});

	it('preserves the existing year when the metadata date is missing', () => {
		const book = new Book({
			filepath: '/books/example.pdf',
			title: 'Filename',
			author: 'Unknown',
			year: 2020,
		});

		book.update({ title: 'Catalog title', authors: [] });

		expect(book.Year).toBe(2020);
		expect(book.Author).toBe('Unknown');
	});
});
