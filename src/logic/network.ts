import type MyPlugin from '../main';
import { ISBN10, ISBN13 } from '../model/isbn';
import { BookMetadata } from '../model/metadata';
import type { OpenLibrarySearchResponse } from '../model/open-library-requests';
import { requestUrl } from 'obsidian';
import { access, mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { delay, throwIfAborted } from '../utils/cancellation';

const MAX_METADATA_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 10_000;
const MAX_SERVER_RETRY_DELAY_MS = 5 * 60 * 1000;
const OPEN_LIBRARY_REQUEST_INTERVAL_MS = 1_000;
const IMAGE_EXTENSIONS = ['.jpg', '.png', '.webp', '.gif', '.avif', '.bmp', '.tif', '.svg'];
const PROJECT_URL = 'https://github.com/Ktn-lwl/obsidian-desktop-shelf';
let openLibraryQueue: Promise<void> = Promise.resolve();
let nextOpenLibraryRequestAt = 0;

export class EgressClient {
	private readonly plugin: MyPlugin;

	constructor(plugin: MyPlugin) {
		this.plugin = plugin;
	}

	async downloadImage(
		url: string,
		isbn: ISBN10 | ISBN13,
		signal?: AbortSignal,
	): Promise<string | undefined> {
		this.checkNetworkAccess(signal);
		for (const extension of IMAGE_EXTENSIONS) {
			const cachedImage = join(this.plugin.imagesDir, `${isbn}${extension}`);
			if (await this.exists(cachedImage)) {
				return cachedImage;
			}
		}

		const coverUrl = new URL(url);
		if (coverUrl.protocol !== 'https:') {
			throw new Error(`Refusing to download a non-HTTPS cover URL: ${url}`);
		}
		coverUrl.searchParams.delete('edge');

		this.checkNetworkAccess(signal);
		const response = await requestUrl({
			url: coverUrl.toString(),
			throw: false,
		});

		this.checkNetworkAccess(signal);
		if (response.status === 429 || response.status >= 500) {
			throw new Error(
				`Cover download transient error (HTTP ${response.status}) for ISBN ${isbn}`,
			);
		} else if (response.status !== 200) {
			// permanent: no usable cover at this URL
			return undefined;
		}

		const contentType = response.headers['content-type'] ?? '';
		const extension = imageExtension(contentType);
		if (!extension) {
			return undefined;
		}

		const dest = join(this.plugin.imagesDir, `${isbn}${extension}`);
		if (await this.exists(dest)) {
			return dest;
		}

		// Move covers downloaded by earlier versions from their extensionless name.
		const legacyDest = join(this.plugin.imagesDir, isbn);
		if (await this.exists(legacyDest)) {
			this.checkNetworkAccess(signal);
			await rename(legacyDest, dest).catch(async (error: NodeJS.ErrnoException) => {
				if (error.code !== 'ENOENT' || !(await this.exists(dest))) throw error;
			});
			return dest;
		}

		// tracking pixel / placeholder
		if (response.arrayBuffer.byteLength < 1024) {
			return undefined;
		}

		await mkdir(this.plugin.imagesDir, { recursive: true });

		const tmp = `${dest}.${crypto.randomUUID()}.tmp`;
		try {
			this.checkNetworkAccess(signal);
			await writeFile(tmp, Buffer.from(response.arrayBuffer), { flag: 'wx' });
			this.checkNetworkAccess(signal);
			await rename(tmp, dest);
		} finally {
			await unlink(tmp).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== 'ENOENT') throw error;
			});
		}

		return dest;
	}

	async fetchMetadata(
		isbn: ISBN10 | ISBN13,
		signal?: AbortSignal,
	): Promise<BookMetadata | undefined> {
		this.checkNetworkAccess(signal);
		return enqueueOpenLibraryRequest(async () => {
			this.checkNetworkAccess(signal);
			const params = new URLSearchParams({
				isbn,
				limit: '1',
				fields: 'title,subtitle,author_name,publisher,first_publish_year,number_of_pages_median',
			});
			const url = `https://openlibrary.org/search.json?${params}`;
			let response: Awaited<ReturnType<typeof requestUrl>> | undefined;

			for (let attempt = 0; attempt <= MAX_METADATA_RETRIES; attempt++) {
				await waitForOpenLibrarySlot(signal);
				this.checkNetworkAccess(signal);
				response = await requestUrl({
					url,
					headers: {
						'User-Agent': `Desktop Shelf/${this.plugin.manifest.version} (${PROJECT_URL})`,
					},
					throw: false,
				});

				this.checkNetworkAccess(signal);
				const transient = response.status === 429 || response.status >= 500;
				if (!transient || attempt === MAX_METADATA_RETRIES) break;

				const retryDelay = getRetryDelay(response.headers, attempt);
				if (retryDelay > MAX_SERVER_RETRY_DELAY_MS) {
					throw new Error(
						`Open Library requested a retry delay of ${retryDelay}ms, exceeding the ${MAX_SERVER_RETRY_DELAY_MS}ms limit`,
					);
				}
				await delay(retryDelay, signal);
			}

			if (!response) {
				throw new Error('Open Library request did not produce a response');
			}
			if (response.status !== 200) {
				if (response.status === 429 || response.status >= 500) {
					throw new Error(
						`Open Library transient error (HTTP ${response.status}) after ${MAX_METADATA_RETRIES + 1} attempts`,
					);
				}
				throw new Error(
					`Open Library request failed (HTTP ${response.status}): ${response.text}`,
				);
			}

			const body = response.json as OpenLibrarySearchResponse;
			const book = body.docs?.[0];
			if (!book?.title) return undefined;

			return {
				title: book.title,
				subtitle: book.subtitle,
				authors: book.author_name ?? ['Unknown'],
				publisher: book.publisher?.[0],
				publishedDate: book.first_publish_year?.toString(),
				pageCount: book.number_of_pages_median,
				coverUrl: googleBooksCoverUrl(isbn),
			};
		});
	}

	private checkNetworkAccess(signal?: AbortSignal): void {
		throwIfAborted(signal);
		if (this.plugin.settings.onlineLookupEnabled !== true) {
			throw new Error(
				'Enable online book lookup in settings before requesting metadata or covers',
			);
		}
	}

	private async exists(filepath: string): Promise<boolean> {
		try {
			await access(filepath);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
			throw error;
		}
	}
}

function enqueueOpenLibraryRequest<T>(operation: () => Promise<T>): Promise<T> {
	const result = openLibraryQueue.then(operation);
	openLibraryQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

async function waitForOpenLibrarySlot(signal?: AbortSignal): Promise<void> {
	const delayMs = nextOpenLibraryRequestAt - Date.now();
	if (delayMs > 0) await delay(delayMs, signal);
	nextOpenLibraryRequestAt = Date.now() + OPEN_LIBRARY_REQUEST_INTERVAL_MS;
}

function googleBooksCoverUrl(isbn: ISBN10 | ISBN13): string {
	const url = new URL('https://books.google.com/books/content');
	url.searchParams.set('vid', `ISBN${isbn}`);
	url.searchParams.set('printsec', 'frontcover');
	url.searchParams.set('img', '1');
	url.searchParams.set('zoom', '1');
	return url.toString();
}

function getRetryDelay(headers: Record<string, string>, attempt: number): number {
	const retryAfter = Object.entries(headers).find(
		([name]) => name.toLowerCase() === 'retry-after',
	)?.[1];
	if (retryAfter) {
		const seconds = Number(retryAfter);
		const retryAt = Number.isNaN(seconds)
			? Date.parse(retryAfter)
			: Date.now() + seconds * 1000;
		if (!Number.isNaN(retryAt)) {
			return Math.max(0, retryAt - Date.now());
		}
	}

	return Math.min(MAX_RETRY_DELAY_MS, INITIAL_RETRY_DELAY_MS * 2 ** attempt);
}

function imageExtension(contentType: string): string | undefined {
	const mimeType = contentType.split(';', 1)[0]?.trim().toLowerCase();
	switch (mimeType) {
		case 'image/jpeg':
		case 'image/jpg':
			return '.jpg';
		case 'image/png':
		case 'image/x-png':
			return '.png';
		case 'image/webp':
			return '.webp';
		case 'image/gif':
			return '.gif';
		case 'image/avif':
			return '.avif';
		case 'image/bmp':
		case 'image/x-ms-bmp':
			return '.bmp';
		case 'image/tiff':
			return '.tif';
		case 'image/svg+xml':
			return '.svg';
		default:
			return undefined;
	}
}
