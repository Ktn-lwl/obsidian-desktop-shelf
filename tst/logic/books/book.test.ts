import { describe, expect, it } from 'vitest';
import { Book, BookProps, MetadataUpdateStatus } from '../../../src/logic/books/book';

describe('Book catalog records', () => {
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
});
