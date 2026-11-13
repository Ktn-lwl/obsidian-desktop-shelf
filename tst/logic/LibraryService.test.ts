import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import type DesktopLibrary from '../../src/main';
import { LibraryService } from '../../src/logic/LibraryService';
import { Book } from '../../src/logic/books/book';
import { assertISBN13 } from '../../src/model/isbn';

const ISBN_VALUE = '9780999999998';

function makeResponse(status: number, json: unknown = {}, headers: Record<string, string> = {}) {
	return {
		status,
		json,
		text: JSON.stringify(json),
		headers,
		arrayBuffer: new ArrayBuffer(0),
	};
}

function makePlugin() {
	return {
		imagesDir: '/unused',
		manifest: { version: '1.0.0' },
		settings: { onlineLookupEnabled: true },
	} as unknown as DesktopLibrary;
}

describe('LibraryService metadata updates', () => {
	beforeEach(() => {
		vi.mocked(requestUrl).mockReset();
		vi.stubGlobal('window', {
			setTimeout: (callback: () => void) => {
				callback();
				return 0;
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('keeps local books pending and makes no requests while online lookup is disabled', async () => {
		const plugin = makePlugin();
		plugin.settings.onlineLookupEnabled = false;
		const isbn = ISBN_VALUE;
		assertISBN13(isbn);
		const book = new Book({
			filepath: '/books/example.pdf',
			title: 'Local title',
			author: 'Unknown',
			isbn13: isbn,
		});
		await new LibraryService(plugin).updateBook(book);
		expect(requestUrl).not.toHaveBeenCalled();
		expect(book.Title).toBe('Local title');
		expect(book.canUpdate).toBe(true);
	});

	it('ignores metadata returned after cancellation and skips the cover request', async () => {
		const controller = new AbortController();
		vi.mocked(requestUrl).mockImplementationOnce(() => {
			controller.abort();
			const response = makeResponse(200, { docs: [{ title: 'Cancelled title' }] });
			return Object.assign(Promise.resolve(response), {
				arrayBuffer: Promise.resolve(response.arrayBuffer),
				json: Promise.resolve(response.json),
				text: Promise.resolve(response.text),
			});
		});
		const isbn = ISBN_VALUE;
		assertISBN13(isbn);
		const book = new Book({
			filepath: '/books/example.pdf',
			title: 'Local title',
			author: 'Unknown',
			isbn13: isbn,
		});
		await expect(
			new LibraryService(makePlugin()).updateBook(book, controller.signal),
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(book.Title).toBe('Local title');
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});

	it('fetches Open Library metadata and applies it to the catalog book', async () => {
		vi.mocked(requestUrl)
			.mockResolvedValueOnce(
				makeResponse(200, {
					docs: [
						{
							title: 'Catalog title',
							author_name: ['Ada Lovelace'],
							first_publish_year: 2019,
							number_of_pages_median: 321,
						},
					],
				}),
			)
			.mockResolvedValueOnce(makeResponse(404));
		const isbn = ISBN_VALUE;
		assertISBN13(isbn);
		const book = new Book({
			filepath: '/books/example.pdf',
			title: 'example.pdf',
			author: 'Unknown',
			isbn13: isbn,
		});

		await new LibraryService(makePlugin()).updateBook(book);

		expect(book.Title).toBe('Catalog title');
		expect(book.Author).toBe('Ada Lovelace');
		expect(book.Year).toBe(2019);
		expect(book.canUpdate).toBe(false);
		expect(vi.mocked(requestUrl)).toHaveBeenCalledTimes(2);
		const request = vi.mocked(requestUrl).mock.calls[0]![0];
		const url = typeof request === 'string' ? request : request.url;
		expect(new URL(url).hostname).toBe('openlibrary.org');
		expect(new URL(url).searchParams.get('isbn')).toBe(ISBN_VALUE);
	});

	it('retries a transient Open Library 503 and applies the successful response', async () => {
		vi.mocked(requestUrl)
			.mockResolvedValueOnce(makeResponse(503))
			.mockResolvedValueOnce(
				makeResponse(200, {
					docs: [{ title: 'Recovered title', author_name: ['Ada Lovelace'] }],
				}),
			)
			.mockResolvedValueOnce(makeResponse(404));
		const isbn = ISBN_VALUE;
		assertISBN13(isbn);
		const book = new Book({
			filepath: '/books/example.pdf',
			title: 'example.pdf',
			author: 'Unknown',
			isbn13: isbn,
		});

		await new LibraryService(makePlugin()).updateBook(book);

		expect(requestUrl).toHaveBeenCalledTimes(3);
		expect(book.Title).toBe('Recovered title');
		expect(book.canUpdate).toBe(false);
	});

	it('keeps fetched metadata and marks the book retryable when cover download fails', async () => {
		vi.mocked(requestUrl)
			.mockResolvedValueOnce(
				makeResponse(200, {
					docs: [
						{
							title: 'Catalog title',
							author_name: ['Ada Lovelace'],
						},
					],
				}),
			)
			.mockResolvedValueOnce(makeResponse(503));
		const isbn = ISBN_VALUE;
		assertISBN13(isbn);
		const book = new Book({
			filepath: '/books/example.pdf',
			title: 'example.pdf',
			author: 'Unknown',
			isbn13: isbn,
		});

		await new LibraryService(makePlugin()).updateBook(book);

		expect(book.Title).toBe('Catalog title');
		expect(book.canUpdate).toBe(true);
		expect(requestUrl).toHaveBeenCalledTimes(2);
		const coverRequest = vi.mocked(requestUrl).mock.calls[1]![0];
		const coverUrl = typeof coverRequest === 'string' ? coverRequest : coverRequest.url;
		expect(new URL(coverUrl).hostname).toBe('books.google.com');
		const coverParams = new URL(coverUrl).searchParams;
		expect(coverParams.get('vid')).toBe(`ISBN${ISBN_VALUE}`);
		expect(coverParams.get('printsec')).toBe('frontcover');
		expect(coverParams.get('img')).toBe('1');
		expect(coverParams.get('zoom')).toBe('1');
	});

	it('does not mark a metadata miss as retryable', async () => {
		vi.mocked(requestUrl).mockResolvedValue(makeResponse(200, { docs: [] }));
		const isbn = ISBN_VALUE;
		assertISBN13(isbn);
		const book = new Book({
			filepath: '/books/example.pdf',
			title: 'example.pdf',
			author: 'Unknown',
			isbn13: isbn,
		});

		await new LibraryService(makePlugin()).updateBook(book);

		expect(book.Title).toBe('example.pdf');
		expect(book.canUpdate).toBe(false);
	});
});
