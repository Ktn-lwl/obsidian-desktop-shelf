import { loadPdfJs } from 'obsidian';
import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';
import type { BookProps } from '../logic/books/book';
import { throwIfAborted } from '../utils/cancellation';

// Render one visible book at a time, avoiding multiple large PDFs in memory.
let queue: Promise<unknown> = Promise.resolve();

export function loadPdfPreview(
	book: Pick<BookProps, 'filepath' | 'filepaths'>,
	coversDir: string,
	signal: AbortSignal,
	document: Document,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
	const result = queue.then(async () => {
		for (const filepath of new Set([book.filepath, ...(book.filepaths ?? [])])) {
			if (signal.aborted) return;
			try {
				if (!isAbsolute(filepath) || extname(filepath).toLowerCase() !== '.pdf') continue;
				const info = await stat(filepath);
				if (!info.isFile()) continue;
				const key = createHash('sha256')
					.update(JSON.stringify(['first-page-v1', filepath, info.mtimeMs, info.size]))
					.digest('hex');
				const directory = join(coversDir, 'previews');
				const cachePath = join(directory, `${key}.png`);
				try {
					return new Uint8Array(await readFile(cachePath, { signal }));
				} catch {
					throwIfAborted(signal);
				}
				const data = await renderFirstPage(filepath, signal, document);
				throwIfAborted(signal);
				const temporaryPath = `${cachePath}.${randomUUID()}.tmp`;
				try {
					await mkdir(directory, { recursive: true });
					await writeFile(temporaryPath, data, { signal });
					throwIfAborted(signal);
					await rename(temporaryPath, cachePath);
				} catch {
					// The preview can still display if its cache cannot be written.
				} finally {
					await unlink(temporaryPath).catch(() => {});
				}
				return data;
			} catch {
				// Try another copy; unreadable PDFs retain the title placeholder.
			}
		}
		return undefined;
	});
	queue = result.catch(() => {});
	return result;
}

async function renderFirstPage(
	filepath: string,
	signal: AbortSignal,
	document: Document,
): Promise<Uint8Array<ArrayBuffer>> {
	const data = await readFile(filepath, { signal });
	const pdfjs = (await loadPdfJs()) as typeof import('pdfjs-dist');
	throwIfAborted(signal);
	const canvas = document.createElement('canvas');
	const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false });
	const cancel = () => {
		void task.destroy().catch(() => {});
	};
	signal.addEventListener('abort', cancel, { once: true });
	try {
		const pdf = await task.promise;
		throwIfAborted(signal);
		const page = await pdf.getPage(1);
		try {
			const original = page.getViewport({ scale: 1 });
			const scale = Math.min(240 / original.width, 360 / original.height, 1);
			if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid PDF page size');
			const viewport = page.getViewport({ scale });
			canvas.width = Math.ceil(viewport.width);
			canvas.height = Math.ceil(viewport.height);
			const context = canvas.getContext('2d');
			if (!context) throw new Error('Canvas unavailable');
			await page.render({ canvas, canvasContext: context, viewport, background: 'white' })
				.promise;
			throwIfAborted(signal);
			const blob = await new Promise<Blob>((resolve, reject) => {
				canvas.toBlob(
					(blob) => (blob ? resolve(blob) : reject(new Error('Preview encoding failed'))),
					'image/png',
				);
			});
			return new Uint8Array(await blob.arrayBuffer());
		} finally {
			page.cleanup();
		}
	} finally {
		signal.removeEventListener('abort', cancel);
		canvas.width = canvas.height = 0;
		await task.destroy();
	}
}
