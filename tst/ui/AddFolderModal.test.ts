import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { readdir, stat } from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';

import { AddFolderModal } from '../../src/ui/AddFolderModal';
import {
	App,
	ButtonComponent,
	keyboardEvent,
	Modal,
	Notice,
	TextComponent,
} from '../mocks/obsidian';

vi.mock('node:fs/promises', () => ({
	readdir: vi.fn(),
	stat: vi.fn(),
}));

// readdir/stat are heavily overloaded (by encoding, withFileTypes,
// recursive...). Letting `vi.mocked(readdir)` infer against the *whole*
// overloaded type pulls in overloads we never call — including the
// encoding:'buffer' one that returns Dirent<NonSharedBuffer>, which is
// where that type error came from. AddFolderModal only ever calls
// `readdir(path, { withFileTypes: true })` with no encoding, so narrowing
// to that one overload here sidesteps the rest entirely.
const mockReaddir = readdir as unknown as Mock<
	(path: string, options: { withFileTypes: true }) => Promise<Dirent[]>
>;
const mockStat = stat as unknown as Mock<(path: string) => Promise<Stats>>;

interface TestableFolderSuggestions {
	getSuggestions(query: string): Promise<string[]>;
}

function suggestionsOf(modal: AddFolderModal): TestableFolderSuggestions {
	return modal.suggestionModal as unknown as TestableFolderSuggestions;
}

function lastText() {
	return TextComponent.instances.at(-1)!;
}

function lastButton() {
	return ButtonComponent.instances.at(-1)!;
}

function dirent(name: string, isDir: boolean): Dirent {
	return { name, isDirectory: () => isDir } as unknown as Dirent;
}

function spyMethod(obj: object, key: string): Mock {
	return (obj as Record<string, unknown>)[key] as Mock;
}

beforeEach(() => {
	vi.clearAllMocks();
	TextComponent.instances = [];
	ButtonComponent.instances = [];
	Modal.instances = [];
});

describe('AddFolderModal', () => {
	it('prefills a save directory and waits for persistence before closing', async () => {
		mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
		let finish!: () => void;
		const onSubmit = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const modal = new AddFolderModal(new App(), onSubmit, {
			title: 'Select save directory',
			initialPath: '/library',
			submitText: 'Save directory',
		});
		expect(lastText().getValue()).toBe('/library');
		expect(lastButton().disabled).toBe(false);
		lastButton().click();
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith('/library'));
		expect(lastButton().disabled).toBe(true);
		expect(spyMethod(modal, 'close')).not.toHaveBeenCalled();
		finish();
		await vi.waitFor(() => expect(spyMethod(modal, 'close')).toHaveBeenCalledOnce());
	});

	it('keeps the picker open and permits retry when persistence fails', async () => {
		mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const modal = new AddFolderModal(
			new App(),
			vi.fn().mockRejectedValue(new Error('Disk full')),
			{
				initialPath: '/library',
			},
		);
		lastButton().click();
		await vi.waitFor(() =>
			expect(Notice).toHaveBeenCalledWith('Could not save folder. Try again.'),
		);
		expect(spyMethod(modal, 'close')).not.toHaveBeenCalled();
		expect(lastButton().disabled).toBe(false);
		log.mockRestore();
	});

	it('starts with the submit button disabled', () => {
		new AddFolderModal(new App(), vi.fn());
		expect(lastButton().disabled).toBe(true);
	});

	it('enables the submit button once a non-blank path is typed', () => {
		new AddFolderModal(new App(), vi.fn());
		lastText().simulateInput('/Users/kitan');
		expect(lastButton().disabled).toBe(false);
	});

	it('treats whitespace-only input as blank (folderPath is trimmed)', () => {
		new AddFolderModal(new App(), vi.fn());
		lastText().simulateInput('   ');
		expect(lastButton().disabled).toBe(true);
	});

	it('re-disables the button when the field is cleared', () => {
		new AddFolderModal(new App(), vi.fn());
		lastText().simulateInput('/Users/kitan');
		lastText().simulateInput('');
		expect(lastButton().disabled).toBe(true);
	});

	it('submits on Enter when the path exists and is a directory', async () => {
		mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
		const onSubmit = vi.fn();
		new AddFolderModal(new App(), onSubmit);

		lastText().simulateInput('/Users/kitan/Books');
		lastText().inputEl.dispatchEvent(keyboardEvent('Enter'));
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());

		expect(onSubmit).toHaveBeenCalledWith('/Users/kitan/Books');
		expect(spyMethod(Modal.instances.at(-1)!, 'close')).toHaveBeenCalled();
	});

	it('does nothing on Enter while the button is disabled (blank path)', () => {
		const onSubmit = vi.fn();
		new AddFolderModal(new App(), onSubmit);

		lastText().inputEl.dispatchEvent(keyboardEvent('Enter'));

		expect(onSubmit).not.toHaveBeenCalled();
		expect(mockStat).not.toHaveBeenCalled();
	});

	it.each(['.', '../books', 'books/archive', 'C:books'])(
		'rejects relative folder %s before checking the filesystem',
		(path) => {
			const onSubmit = vi.fn();
			new AddFolderModal(new App(), onSubmit);
			lastText().simulateInput(path);
			lastText().inputEl.dispatchEvent(keyboardEvent('Enter'));
			expect(lastButton().disabled).toBe(true);
			expect(mockStat).not.toHaveBeenCalled();
			expect(onSubmit).not.toHaveBeenCalled();
		},
	);

	it('shows a Notice and does not submit when the path does not exist', async () => {
		mockStat.mockRejectedValue(new Error('ENOENT'));
		const onSubmit = vi.fn();
		const modal = new AddFolderModal(new App(), onSubmit);

		lastText().simulateInput('/nope');
		lastButton().click();
		await vi.waitFor(() => expect(Notice).toHaveBeenCalled());

		expect(onSubmit).not.toHaveBeenCalled();
		expect(spyMethod(modal, 'close')).not.toHaveBeenCalled();
		expect(Notice).toHaveBeenCalledWith('directory: /nope not found');
	});

	it('treats an existing non-directory path as not found', async () => {
		mockStat.mockResolvedValue({ isDirectory: () => false } as Stats);
		const onSubmit = vi.fn();
		new AddFolderModal(new App(), onSubmit);

		lastText().simulateInput('/Users/kitan/notes.md');
		lastButton().click();
		await vi.waitFor(() => expect(Notice).toHaveBeenCalled());

		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('clicking "Add folder" submits the same way as pressing Enter', async () => {
		mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
		const onSubmit = vi.fn();
		new AddFolderModal(new App(), onSubmit);

		lastText().simulateInput('/Users/kitan/Books');
		lastButton().click();
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());

		expect(onSubmit).toHaveBeenCalledWith('/Users/kitan/Books');
	});

	it('closes the suggestion popup on close', () => {
		const modal = new AddFolderModal(new App(), vi.fn());
		modal.onClose();
		expect(spyMethod(modal.suggestionModal, 'close')).toHaveBeenCalled();
	});
});

describe('FolderSuggestions (via AddFolderModal.suggestionModal)', () => {
	it('lists directories (not files) under a trailing-slash root, unfiltered', async () => {
		mockReaddir.mockResolvedValue([
			dirent('Documents', true),
			dirent('notes.txt', false),
			dirent('Downloads', true),
		]);

		const modal = new AddFolderModal(new App(), vi.fn());
		const results = await suggestionsOf(modal).getSuggestions('/Users/');

		expect(mockReaddir).toHaveBeenCalledWith('/Users/', { withFileTypes: true });
		expect(results).toEqual(['/Users/Documents', '/Users/Downloads']);
	});

	it('filters by the partial segment once a prior "/" establishes the root', async () => {
		mockReaddir.mockResolvedValue([
			dirent('Documents', true),
			dirent('Downloads', true),
			dirent('Desktop', true),
		]);

		const modal = new AddFolderModal(new App(), vi.fn());
		const results = await suggestionsOf(modal).getSuggestions('/Users/Do');

		expect(mockReaddir).toHaveBeenCalledWith('/Users/', { withFileTypes: true });
		expect(results.sort()).toEqual(['/Users/Documents', '/Users/Downloads']);
	});

	it.each([
		['Us', ['/Users']],
		['/Us', ['/Users']],
		['Missing', []],
		['', ['/Users', '/Applications']],
		['/', ['/Users', '/Applications']],
	])('filters root directories for query "%s"', async (query, expected) => {
		mockReaddir.mockResolvedValue([dirent('Users', true), dirent('Applications', true)]);

		const modal = new AddFolderModal(new App(), vi.fn());
		const results = await suggestionsOf(modal).getSuggestions(query);

		expect(mockReaddir).toHaveBeenCalledWith('/', { withFileTypes: true });
		expect(results).toEqual(expected);
	});

	it('returns an empty list when the directory cannot be read', async () => {
		mockReaddir.mockRejectedValue(new Error('ENOENT'));

		const modal = new AddFolderModal(new App(), vi.fn());
		const results = await suggestionsOf(modal).getSuggestions('/nope/');

		expect(results).toEqual([]);
	});

	it('matches folder prefixes case-sensitively', async () => {
		mockReaddir.mockResolvedValue([
			dirent('Documents', true),
			dirent('Downloads', true),
			dirent('documents-backup', true),
			dirent('Desktop', true),
		]);
		const modal = new AddFolderModal(new App(), vi.fn());
		const results = await suggestionsOf(modal).getSuggestions('/Users/Do');
		expect(results).toEqual(['/Users/Documents', '/Users/Downloads']);
	});

	it('selectSuggestion fills in the text box with a trailing slash and re-triggers onChange', () => {
		const modal = new AddFolderModal(new App(), vi.fn());

		modal.suggestionModal.selectSuggestion('/Users/kitan/Books');

		expect(lastText().getValue()).toBe('/Users/kitan/Books/');
		// Confirms the manual dispatchEvent('input') call actually does
		// something: if it didn't, folderPath (and the button) wouldn't
		// have picked up the new value.
		expect(lastButton().disabled).toBe(false);
	});
});
