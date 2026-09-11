import { describe, it, expect } from 'vitest';
import { discoverISBNs, extractText } from '../../../src/logic/books/isbn-extractor';
import type { Book } from '../../../src/logic/books/book';

import path from 'node:path';

function fakeBook(filepath: string): Book {
	return { getFilepath: () => filepath } as unknown as Book;
}

const CALCULUS_VOL_3 = path.resolve(process.cwd(), 'docs/misc/sample-test-fixture.pdf');

describe('extractText', () => {
	it('pulls real text out of the fixture PDF', async () => {
		const book = fakeBook(CALCULUS_VOL_3);
		const result = await extractText(book);

		expect(result).not.toBeNull();
		expect(result!.text.length).toBeGreaterThan(0);
		expect(result!.text.toLowerCase()).toContain('sample');
	}, 15000);
});

describe('discoverISBNs', () => {
	it('finds a checksum-valid ISBN-13 in the first 10 pages', async () => {
		const book = fakeBook(CALCULUS_VOL_3);
		const result = await discoverISBNs(book);

		expect(result.ISBN13).not.toBeNull();
		expect(result.ISBN13).toBe('9780999999998');
	}, 15000);

	it('finds a checksum-valid ISBN-10 in the first 10 pages', async () => {
		const book = fakeBook(CALCULUS_VOL_3);
		const result = await discoverISBNs(book);

		expect(result.ISBN10).not.toBeNull();
		expect(result.ISBN10).toBe('0999999990');
	}, 15000);
});
