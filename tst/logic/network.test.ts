import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type DesktopLibrary from '../../src/main';
import { EgressClient } from '../../src/logic/network';
import { assertISBN13 } from '../../src/model/isbn';

const ISBN_VALUE = '9780999999998';
let imagesDir: string;
let metadataTime = Date.now();

function makePlugin() {
	return {
		imagesDir,
		manifest: { version: '1.0.0' },
		settings: { onlineLookupEnabled: true },
	} as unknown as DesktopLibrary;
}

function makeImageResponse(contentType: string) {
	const bytes = new Uint8Array(2048).fill(1);
	return {
		status: 200,
		headers: { 'content-type': contentType },
		arrayBuffer: bytes.buffer,
		text: '',
		json: {},
	};
}

function makeMetadataResponse(status: number, headers: Record<string, string> = {}) {
	return {
		status,
		headers,
		text: '',
		json: { docs: [{ title: 'Test book', author_name: ['Test author'] }] },
		arrayBuffer: new ArrayBuffer(0),
	};
}

describe('EgressClient image downloads', () => {
	beforeEach(async () => {
		imagesDir = await mkdtemp(join(tmpdir(), 'desktop-shelf-covers-'));
		vi.mocked(requestUrl).mockReset();
	});

	afterEach(async () => {
		await rm(imagesDir, { recursive: true, force: true });
	});

	it('allows concurrent downloads of the same cover without sharing temporary files', async () => {
		vi.mocked(requestUrl).mockResolvedValue(makeImageResponse('image/jpeg'));
		const isbn = ISBN_VALUE;
		assertISBN13(isbn);
		const paths = await Promise.all(
			Array.from({ length: 12 }, () =>
				new EgressClient(makePlugin()).downloadImage('https://covers.example/book', isbn),
			),
		);
		expect(new Set(paths)).toEqual(new Set([join(imagesDir, `${ISBN_VALUE}.jpg`)]));
		await expect(readFile(paths[0]!)).resolves.toEqual(Buffer.alloc(2048, 1));
		await expect(readdir(imagesDir)).resolves.toEqual([`${ISBN_VALUE}.jpg`]);
	});

	it('does not write a cover when cancelled during the request', async () => {
		const controller = new AbortController();
		vi.mocked(requestUrl).mockImplementationOnce(() => {
			controller.abort();
			const response = makeImageResponse('image/jpeg');
			return Object.assign(Promise.resolve(response), {
				arrayBuffer: Promise.resolve(response.arrayBuffer),
				json: Promise.resolve(response.json),
				text: Promise.resolve(response.text),
			});
		});
		const isbn = ISBN_VALUE;
		assertISBN13(isbn);
		await expect(
			new EgressClient(makePlugin()).downloadImage(
				'https://covers.example/book',
				isbn,
				controller.signal,
			),
		).rejects.toMatchObject({ name: 'AbortError' });
		await expect(readdir(imagesDir)).resolves.toEqual([]);
	});

	it('uses a filename extension matching the downloaded image content type', async () => {
		vi.mocked(requestUrl).mockResolvedValue(makeImageResponse('image/jpeg; charset=binary'));
		const isbn = ISBN_VALUE;
		assertISBN13(isbn);

		const filepath = await new EgressClient(makePlugin()).downloadImage(
			'https://covers.example/book',
			isbn,
		);

		expect(filepath).toBe(join(imagesDir, `${ISBN_VALUE}.jpg`));
		await expect(readFile(filepath!)).resolves.toHaveLength(2048);
	});

	it('renames an existing extensionless cover from the previous format', async () => {
		const legacyPath = join(imagesDir, ISBN_VALUE);
		await writeFile(legacyPath, new Uint8Array(2048).fill(2));
		vi.mocked(requestUrl).mockResolvedValue(makeImageResponse('image/png'));
		const isbn = ISBN_VALUE;
		assertISBN13(isbn);

		const filepath = await new EgressClient(makePlugin()).downloadImage(
			'https://covers.example/book',
			isbn,
		);

		expect(filepath).toBe(join(imagesDir, `${ISBN_VALUE}.png`));
		await expect(readFile(filepath!)).resolves.toHaveLength(2048);
		await expect(rm(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' });
	});
});

describe('EgressClient metadata requests', () => {
	beforeEach(() => {
		vi.mocked(requestUrl).mockReset();
		vi.useFakeTimers();
		metadataTime += 10 * 60_000;
		vi.setSystemTime(metadataTime);
		vi.stubGlobal('window', { setTimeout, clearTimeout });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('blocks metadata and cover requests unless online lookup is explicitly enabled', async () => {
		const plugin = makePlugin();
		plugin.settings.onlineLookupEnabled = false;
		const isbn = ISBN_VALUE;
		assertISBN13(isbn);
		const client = new EgressClient(plugin);
		await expect(client.fetchMetadata(isbn)).rejects.toThrow('Enable online book lookup');
		await expect(client.downloadImage('https://covers.example/book', isbn)).rejects.toThrow(
			'Enable online book lookup',
		);
		expect(requestUrl).not.toHaveBeenCalled();
	});

	it('cancels retry waits without issuing another request', async () => {
		vi.mocked(requestUrl).mockResolvedValue(
			makeMetadataResponse(429, { 'Retry-After': '120' }),
		);
		const isbn = ISBN_VALUE;
		assertISBN13(isbn);
		const controller = new AbortController();
		const result = new EgressClient(makePlugin()).fetchMetadata(isbn, controller.signal);
		const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
		await vi.advanceTimersByTimeAsync(1000);
		expect(requestUrl).toHaveBeenCalledTimes(1);
		controller.abort();
		await rejected;
		await vi.advanceTimersByTimeAsync(120_000);
		expect(requestUrl).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('paces concurrent requests and identifies the plugin', async () => {
		vi.mocked(requestUrl).mockResolvedValue(makeMetadataResponse(200));
		const isbn = ISBN_VALUE;
		assertISBN13(isbn);
		const first = new EgressClient(makePlugin()).fetchMetadata(isbn);
		const second = new EgressClient(makePlugin()).fetchMetadata(isbn);
		await vi.advanceTimersByTimeAsync(0);
		expect(requestUrl).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(999);
		expect(requestUrl).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		await Promise.all([first, second]);

		expect(requestUrl).toHaveBeenCalledTimes(2);
		const request = vi.mocked(requestUrl).mock.calls[0]![0];
		expect(typeof request).not.toBe('string');
		if (typeof request !== 'string') {
			expect(request.headers?.['User-Agent']).toContain('Desktop Shelf/1.0.0');
			expect(request.headers?.['User-Agent']).toContain(
				'github.com/Ktn-lwl/obsidian-desktop-shelf',
			);
		}
	});

	it('honors Retry-After before retrying a rate-limited request', async () => {
		vi.mocked(requestUrl)
			.mockResolvedValueOnce(makeMetadataResponse(429, { 'Retry-After': '2' }))
			.mockResolvedValueOnce(makeMetadataResponse(200));
		const isbn = ISBN_VALUE;
		assertISBN13(isbn);

		await vi.advanceTimersByTimeAsync(60_000);
		const result = new EgressClient(makePlugin()).fetchMetadata(isbn);
		await vi.advanceTimersByTimeAsync(0);
		expect(requestUrl).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1_999);
		expect(requestUrl).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);

		await expect(result).resolves.toMatchObject({ title: 'Test book' });
		expect(requestUrl).toHaveBeenCalledTimes(2);
	});
});
