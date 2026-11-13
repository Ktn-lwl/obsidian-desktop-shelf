import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceLeaf } from 'obsidian';
import type DesktopLibrary from '../../src/main';
import type { BookProps } from '../../src/logic/books/book';
import { TestElement } from './view-mocks';

vi.mock('obsidian', async (importOriginal) => {
	const original = await importOriginal<typeof import('../mocks/obsidian')>();
	const { TestComponent, TestItemView } = await import('./view-mocks');
	return { ...original, Component: TestComponent, ItemView: TestItemView };
});
vi.mock('../../src/ui/local-files', () => ({ openBook: vi.fn() }));

import { LibraryView } from '../../src/ui/LibraryView';
import { openBook } from '../../src/ui/local-files';

async function setup(initialBooks: BookProps[] = []) {
	const listeners = new Set<() => void>();
	const observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
	vi.stubGlobal(
		'IntersectionObserver',
		class {
			constructor() {
				return observer;
			}
		},
	);
	vi.stubGlobal('window', { setTimeout, clearTimeout });
	const library = {
		books: initialBooks,
		status: 'Ready',
		issues: [] as string[],
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	const plugin = {
		library,
		settings: { watchedFolders: [] as string[] },
		imagesDir: '/covers',
		isRefreshing: false,
		refreshError: undefined as string | undefined,
		refreshLibrary: vi.fn(async () => {}),
	};
	const view = new LibraryView({} as WorkspaceLeaf, plugin as unknown as DesktopLibrary);
	await view.onOpen();
	const root = view.contentEl as unknown as TestElement;
	const update = () => listeners.forEach((fn) => fn());
	return { view, root, plugin, library, observer, listeners, update };
}

const book: BookProps = { filepath: '/books/algebra.pdf', title: 'Algebra', author: 'Ada' };

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	vi.useRealTimers();
});

describe('library workspace view', () => {
	it('shows setup guidance and responds to imported catalog updates', async () => {
		const { root, library, update, view } = await setup();
		expect(root.all().some((el) => el.text.includes('Add a folder to build'))).toBe(true);
		library.books = [book];
		update();
		expect(root.all().filter((el) => el.tag === 'article')).toHaveLength(1);
		expect(root.all().some((el) => el.text === 'Algebra')).toBe(true);
		await view.onClose();
	});

	it('keeps existing cards during status updates and opens the local PDF', async () => {
		const { root, library, update, view } = await setup([book]);
		const card = root.all().find((el) => el.tag === 'article');
		library.status = 'Scanning';
		update();
		expect(root.all().find((el) => el.tag === 'article')).toBe(card);
		root.all()
			.find((el) => el.attributes['aria-label'] === 'Open Algebra')!
			.fire('click');
		expect(openBook).toHaveBeenCalledWith(expect.anything(), book);
		await view.onClose();
	});

	it('filters books, shows no results, and clears search', async () => {
		vi.useFakeTimers();
		const { root, view } = await setup([book]);
		const input = root.querySelector('input')!;
		input.value = 'no match';
		input.fire('input');
		await vi.advanceTimersByTimeAsync(150);
		expect(root.all().filter((el) => el.tag === 'article')).toHaveLength(0);
		expect(root.all().some((el) => el.text === 'No books match your search.')).toBe(true);
		root.all()
			.find((el) => el.text === 'Clear search')!
			.fire('click');
		expect(input.value).toBe('');
		expect(root.all().filter((el) => el.tag === 'article')).toHaveLength(1);
		await view.onClose();
	});

	it('disables duplicate refresh actions and surfaces scan errors', async () => {
		const { root, plugin, library, update, view } = await setup([book]);
		const refresh = root.all().find((el) => el.text === 'Refresh')!;
		refresh.fire('click');
		expect(plugin.refreshLibrary).toHaveBeenCalledOnce();
		plugin.isRefreshing = true;
		update();
		expect(refresh.disabled).toBe(true);
		refresh.fire('click');
		expect(plugin.refreshLibrary).toHaveBeenCalledOnce();
		library.issues = ['Could not scan folder: /unplugged'];
		update();
		expect(root.all().some((el) => el.text.includes('/unplugged'))).toBe(true);
		await view.onClose();
	});

	it('disconnects observers and listeners and cancels queued rendering on close', async () => {
		vi.useFakeTimers();
		const { root, view, listeners, observer } = await setup([book]);
		root.querySelector('input')!.fire('input');
		await view.onClose();
		expect(listeners.size).toBe(0);
		expect(observer.disconnect).toHaveBeenCalled();
		expect(observer.unobserve).toHaveBeenCalled();
		await vi.runAllTimersAsync();
		expect(root.children).toHaveLength(0);
	});
});
