import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { TestElement } from './view-mocks';
import { loadPdfPreview } from '../../src/ui/pdf-preview';

vi.mock('../../src/ui/pdf-preview', () => ({ loadPdfPreview: vi.fn() }));

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('obsidian', async (importOriginal) => {
	const original = await importOriginal<typeof import('../mocks/obsidian')>();
	const { TestComponent } = await import('./view-mocks');
	return { ...original, Component: TestComponent };
});
import { BookCard } from '../../src/ui/BookCard';

function setup(path = '/covers/a.png') {
	const root = new TestElement();
	let visible = () => {};
	const stopObserving = vi.fn();
	const card = new BookCard(
		root as unknown as HTMLElement,
		{
			filepath: '/books/a.pdf',
			title: 'A book',
			author: 'An author',
			coverImgSrc: path,
		},
		'/covers',
		() => {},
		() => {},
		(_el, load) => {
			visible = load;
			return stopObserving;
		},
	);
	card.onload();
	return { root, card, show: () => visible(), stopObserving };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.mocked(loadPdfPreview).mockReset();
});

describe('cached shelf covers', () => {
	it('uses a local PDF preview only when visible and no downloaded cover exists', async () => {
		vi.mocked(loadPdfPreview).mockResolvedValue(new Uint8Array([1, 2]));
		const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
		const { card, root, show } = setup('');
		expect(loadPdfPreview).not.toHaveBeenCalled();
		show();
		show();
		await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
		expect(loadPdfPreview).toHaveBeenCalledOnce();
		expect(root.all().some((el) => el.tag === 'img')).toBe(true);
		card.unload();
	});
	it('falls back to the PDF when a downloaded image cannot be decoded', async () => {
		vi.mocked(readFile).mockResolvedValue(Buffer.from('invalid image'));
		vi.mocked(loadPdfPreview).mockResolvedValue(new Uint8Array([1]));
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cover');
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const { card, root, show } = setup();
		show();
		await vi.waitFor(() => expect(root.all().some((el) => el.tag === 'img')).toBe(true));
		root.all()
			.find((el) => el.tag === 'img')!
			.fire('error');
		await vi.waitFor(() => expect(loadPdfPreview).toHaveBeenCalledOnce());
		expect(revoke).toHaveBeenCalledWith('blob:cover');
		card.unload();
	});
	it('cancels preview work and ignores late results when unloaded', async () => {
		let complete!: (data: Uint8Array<ArrayBuffer>) => void;
		vi.mocked(loadPdfPreview).mockImplementation((_book, _dir, signal) => {
			expect(signal.aborted).toBe(false);
			return new Promise((resolve) => {
				complete = resolve;
			});
		});
		const create = vi.spyOn(URL, 'createObjectURL');
		const { card, show } = setup('');
		show();
		const signal = vi.mocked(loadPdfPreview).mock.calls[0]![2];
		card.unload();
		expect(signal.aborted).toBe(true);
		complete(new Uint8Array([1]));
		await Promise.resolve();
		expect(create).not.toHaveBeenCalled();
	});
	it('reads covers only when visible and releases object URLs when removed', async () => {
		vi.mocked(readFile).mockResolvedValue(Buffer.from('image bytes'));
		const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cover');
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const { card, root, show, stopObserving } = setup();
		expect(readFile).not.toHaveBeenCalled();
		show();
		await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
		expect(root.all().some((el) => el.tag === 'img')).toBe(true);
		expect(loadPdfPreview).not.toHaveBeenCalled();
		card.unload();
		expect(revoke).toHaveBeenCalledWith('blob:cover');
		expect(stopObserving).toHaveBeenCalled();
		expect(root.children).toHaveLength(0);
	});
	it('does not create images after the card is unloaded during a read', async () => {
		let complete!: (data: Buffer<ArrayBuffer>) => void;
		vi.mocked(readFile).mockReturnValue(
			new Promise<Buffer<ArrayBuffer>>((resolve) => {
				complete = resolve;
			}),
		);
		const create = vi.spyOn(URL, 'createObjectURL');
		const { card, show, root } = setup();
		show();
		card.unload();
		complete(Buffer.from('image bytes'));
		await Promise.resolve();
		expect(create).not.toHaveBeenCalled();
		expect(root.children).toHaveLength(0);
	});
	it('keeps a placeholder for paths outside the cover cache', async () => {
		const { card, show } = setup('/private/other.png');
		show();
		expect(readFile).not.toHaveBeenCalled();
		card.unload();
	});
});
