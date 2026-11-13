import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPdfJs } from 'obsidian';
import { loadPdfPreview } from '../../src/ui/pdf-preview';

let directory: string;
let filepath: string;
const png = new Uint8Array([137, 80, 78, 71]);
function runtime() {
	const page = {
		getViewport: vi.fn(({ scale }: { scale: number }) => ({
			width: 600 * scale,
			height: 900 * scale,
		})),
		render: vi.fn(() => ({ promise: Promise.resolve() })),
		cleanup: vi.fn(),
	};
	const pdf = { getPage: vi.fn(async (_page: number) => page) };
	const task = { promise: Promise.resolve(pdf), destroy: vi.fn(async () => {}) };
	const getDocument = vi.fn(() => task);
	vi.mocked(loadPdfJs).mockResolvedValue({ getDocument });
	const dimensions: { width: number; height: number }[] = [];
	const canvas = {
		width: 0,
		height: 0,
		getContext: () => ({}),
		toBlob: (callback: (blob: Blob) => void) => {
			dimensions.push({ width: canvas.width, height: canvas.height });
			callback(new Blob([png], { type: 'image/png' }));
		},
	};
	const document = { createElement: vi.fn(() => canvas) } as unknown as Document;
	return { page, pdf, task, getDocument, document, dimensions };
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'shelf-preview-'));
	filepath = join(directory, 'book.pdf');
	await writeFile(filepath, 'PDF bytes');
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	await rm(directory, { recursive: true, force: true });
});

describe('PDF first-page previews', () => {
	it('renders only page one within thumbnail bounds, caches PNG bytes and releases the PDF', async () => {
		const { pdf, task, page, getDocument, document, dimensions } = runtime();
		const signal = new AbortController().signal;
		const covers = join(directory, 'covers');
		expect(await loadPdfPreview({ filepath }, covers, signal, document)).toEqual(png);
		expect(pdf.getPage).toHaveBeenCalledExactlyOnceWith(1);
		expect(dimensions).toEqual([{ width: 240, height: 360 }]);
		expect(page.cleanup).toHaveBeenCalledOnce();
		expect(task.destroy).toHaveBeenCalledOnce();
		const files = await readdir(join(covers, 'previews'));
		expect(files).toHaveLength(1);
		expect(new Uint8Array(await readFile(join(covers, 'previews', files[0]!)))).toEqual(png);
		expect(await loadPdfPreview({ filepath }, covers, signal, document)).toEqual(png);
		expect(getDocument).toHaveBeenCalledOnce();
		await writeFile(filepath, 'changed PDF bytes');
		await utimes(filepath, new Date(), new Date(Date.now() + 2000));
		await loadPdfPreview({ filepath }, covers, signal, document);
		expect(getDocument).toHaveBeenCalledTimes(2);
	});
	it('tries another copy and keeps a placeholder when no PDF can be rendered', async () => {
		const { document, pdf } = runtime();
		const missing = join(directory, 'missing.pdf');
		expect(
			await loadPdfPreview(
				{ filepath: missing, filepaths: [filepath] },
				directory,
				new AbortController().signal,
				document,
			),
		).toEqual(png);
		pdf.getPage.mockRejectedValueOnce(new Error('Damaged PDF'));
		expect(
			await loadPdfPreview(
				{ filepath },
				join(directory, 'new-cache'),
				new AbortController().signal,
				document,
			),
		).toBeUndefined();
	});
	it('serializes PDF loads and skips queued previews cancelled before starting', async () => {
		const { document, task, pdf, getDocument } = runtime();
		let complete!: (value: typeof pdf) => void;
		task.promise = new Promise((resolve) => {
			complete = resolve;
		});
		const first = loadPdfPreview(
			{ filepath },
			directory,
			new AbortController().signal,
			document,
		);
		await vi.waitFor(() => expect(getDocument).toHaveBeenCalledOnce());
		const cancelled = new AbortController();
		const second = loadPdfPreview({ filepath }, directory, cancelled.signal, document);
		cancelled.abort();
		expect(getDocument).toHaveBeenCalledOnce();
		complete(pdf);
		await first;
		expect(await second).toBeUndefined();
		expect(getDocument).toHaveBeenCalledOnce();
	});
	it('destroys an active PDF load on cancellation', async () => {
		const { document, task, pdf } = runtime();
		let complete!: (value: typeof pdf) => void;
		task.promise = new Promise((resolve) => {
			complete = resolve;
		});
		const controller = new AbortController();
		const loading = loadPdfPreview({ filepath }, directory, controller.signal, document);
		await vi.waitFor(() => expect(loadPdfJs).toHaveBeenCalled());
		controller.abort();
		complete(pdf);
		expect(await loading).toBeUndefined();
		expect(task.destroy).toHaveBeenCalled();
		expect(pdf.getPage).not.toHaveBeenCalled();
	});
});
