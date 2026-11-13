import { describe, it, expect, vi } from 'vitest';
import { loadPdfJs } from 'obsidian';
import { discoverISBNs, extractISBNs, extractText } from '../../../src/logic/books/isbn-extractor';

import path from 'node:path';

const BOOK_PATH = path.resolve(process.cwd(), 'docs/misc/sample-test-fixture.pdf');

describe('extractText', () => {
	it('pulls real text out of the fixture PDF', async () => {
		const result = await extractText(BOOK_PATH);

		expect(result).not.toBeNull();
		expect(result!.length).toBeGreaterThan(0);
		expect(result!.toLowerCase()).toContain('sample');
	}, 15000);
});

describe('discoverISBNs', () => {
	it('finds ISBNs in the existing short PDF fixture across its first and last sections', async () => {
		const result = await discoverISBNs(BOOK_PATH);

		expect(result.ISBN13).toBe('9780999999998');
		expect(result.ISBN10).toBe('0999999990');
	}, 15000);

	it('cleans up the current page and document when cancelled during extraction', async () => {
		const controller = new AbortController();
		const cleanup = vi.fn();
		const destroy = vi.fn(async () => {});
		const getPage = vi.fn(async () => ({
			getTextContent: async () => {
				controller.abort();
				return { items: [{ str: 'ISBN 9780306406157' }] };
			},
			cleanup,
		}));
		vi.mocked(loadPdfJs).mockResolvedValueOnce({
			getDocument: () => ({ promise: Promise.resolve({ numPages: 200, getPage, destroy }) }),
		} as Awaited<ReturnType<typeof loadPdfJs>>);
		await expect(discoverISBNs(BOOK_PATH, controller.signal)).rejects.toMatchObject({
			name: 'AbortError',
		});
		expect(getPage).toHaveBeenCalledOnce();
		expect(cleanup).toHaveBeenCalledOnce();
		expect(destroy).toHaveBeenCalledOnce();
	});

	it('scans through page 20 when it falls within the first 10% and stops there', async () => {
		const getPage = vi.fn(async (page: number) => ({
			getTextContent: async () => ({
				items: [{ str: page === 20 ? 'ISBN 9780306406157' : `Page ${page}` }],
			}),
			cleanup: () => {},
		}));
		vi.mocked(loadPdfJs).mockResolvedValueOnce({
			getDocument: () => ({
				promise: Promise.resolve({
					numPages: 200,
					getPage,
					destroy: async () => {},
				}),
			}),
		} as Awaited<ReturnType<typeof loadPdfJs>>);

		const result = await discoverISBNs(BOOK_PATH);

		expect(result.ISBN13).toBe('9780306406157');
		expect(getPage).toHaveBeenCalledTimes(20);
	});

	it('scans the last 10% when no ISBN-13 is found near the front', async () => {
		const getPage = vi.fn(async (page: number) => ({
			getTextContent: async () => ({
				items: [{ str: page === 190 ? 'ISBN 9780306406157' : `Page ${page}` }],
			}),
			cleanup: () => {},
		}));
		vi.mocked(loadPdfJs).mockResolvedValueOnce({
			getDocument: () => ({
				promise: Promise.resolve({
					numPages: 200,
					getPage,
					destroy: async () => {},
				}),
			}),
		} as Awaited<ReturnType<typeof loadPdfJs>>);

		const result = await discoverISBNs(BOOK_PATH);

		expect(result.ISBN13).toBe('9780306406157');
		expect(getPage).toHaveBeenCalledTimes(30);
		expect(getPage).toHaveBeenLastCalledWith(190);
	});

	it('keeps the first ISBN-10 found while scanning the full 10% range for an ISBN-13', async () => {
		const getPage = vi.fn(async (page: number) => ({
			getTextContent: async () => ({
				items: [{ str: page === 1 ? 'ISBN-10: 0-8044-2957-X' : `Page ${page}` }],
			}),
			cleanup: () => {},
		}));
		vi.mocked(loadPdfJs).mockResolvedValueOnce({
			getDocument: () => ({
				promise: Promise.resolve({
					numPages: 200,
					getPage,
					destroy: async () => {},
				}),
			}),
		} as Awaited<ReturnType<typeof loadPdfJs>>);

		const result = await discoverISBNs(BOOK_PATH);

		expect(result.ISBN10).toBe('080442957X');
		expect(result.ISBN13).toBeNull();
		expect(getPage).toHaveBeenCalledTimes(40);
	});

	it('stops scanning early once it finds a valid ISBN-13', async () => {
		const getPage = vi.fn(async () => ({
			getTextContent: async () => ({ items: [{ str: 'ISBN 9780306406157' }] }),
			cleanup: () => {},
		}));
		vi.mocked(loadPdfJs).mockResolvedValueOnce({
			getDocument: () => ({
				promise: Promise.resolve({
					numPages: 200,
					getPage,
					destroy: async () => {},
				}),
			}),
		} as Awaited<ReturnType<typeof loadPdfJs>>);

		const result = await discoverISBNs(BOOK_PATH);

		expect(result.ISBN13).toBe('9780306406157');
		expect(getPage).toHaveBeenCalledOnce();
	});
});

describe('extractISBNs', () => {
	it.each([
		['ISBN 9780306406157', '9780306406157', null],
		['ISBN-13: 978-0-306-40615-7', '9780306406157', null],
		['ISBN 13 978 0 306 40615 7', '9780306406157', null],
		['ISBN-10 — 0-8044-2957-X', null, '080442957X'],
		['ISBN: 0\u00a08044\u00a02957\u00a0X', null, '080442957X'],
	])('extracts formatted identifier from %s', (text, isbn13, isbn10) => {
		const result = extractISBNs(text);

		expect(result.ISBN13).toBe(isbn13);
		expect(result.ISBN10).toBe(isbn10);
	});

	it('continues past invalid candidates and rejects a candidate contaminated by adjacent digits', () => {
		const result = extractISBNs('ISBN 9780306406158 ISBN 9780306406157 ISBN 978030640615712');

		expect(result.ISBN13).toBe('9780306406157');
	});

	it('extracts the first valid ISBN-13 from an ISBNs list with edition labels', () => {
		const result = extractISBNs(
			'ISBNs: 9781394155248 (Hardback), 9781394155545 (epdf), 9781394155255 (epub)',
		);

		expect(result.ISBN13).toBe('9781394155248');
	});
});
