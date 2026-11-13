import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { TestElement } from './view-mocks';

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
});

describe('cached shelf covers', () => {
	it('reads covers only when visible and releases object URLs when removed', async () => {
		vi.mocked(readFile).mockResolvedValue(Buffer.from('image bytes'));
		const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cover');
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const { card, root, show, stopObserving } = setup();
		expect(readFile).not.toHaveBeenCalled();
		show();
		await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
		expect(root.all().some((el) => el.tag === 'img')).toBe(true);
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
