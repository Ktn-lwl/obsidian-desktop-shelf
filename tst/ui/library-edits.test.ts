import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { ISBNMergeRequiredError, type LibraryEdits } from '../../src/logic/library-edits';
import { rows } from './edit-modal-mocks';
import { TestElement } from './view-mocks';
import { parseManualISBN } from '../../src/logic/manual-state';
vi.mock('obsidian', async (importOriginal) => {
	const original = await importOriginal<typeof import('../mocks/obsidian')>();
	const mocks = await import('./edit-modal-mocks');
	return { ...original, Modal: mocks.UiModal, Setting: mocks.UiSetting };
});
import { EditBookModal } from '../../src/ui/EditBookModal';
import { IdentifyBookModal } from '../../src/ui/IdentifyBookModal';
import { AddBooksModal } from '../../src/ui/AddBooksModal';

const app = {} as App;
const book = { filepath: '/books/a.pdf', title: 'Saved title', author: 'Author' };
function edits() {
	return {
		getOverrides: vi.fn(() => ({ title: 'Saved title' })),
		getBaseBook: vi.fn(() => ({ ...book, title: 'Fetched title' })),
		saveOverrides: vi.fn(async () => {}),
		assignISBN: vi.fn(async () => {}),
		previewISBN: vi.fn(),
		candidates: [book],
		setIncluded: vi.fn(async () => {}),
	};
}
function button(label: string) {
	return rows.flatMap((row) => row.buttons).find((button) => button.buttonText === label)!;
}
afterEach(() => {
	rows.length = 0;
	vi.clearAllMocks();
});

describe('native manual edit dialogs', () => {
	it('saves only edited fields and supports resetting a field to fetched details', async () => {
		const service = edits();
		const saved = vi.fn();
		const modal = new EditBookModal(app, book, service as unknown as LibraryEdits, saved);
		modal.onOpen();
		rows.find((row) => row.name === 'Author')!.text!.simulateInput('New author');
		rows.find((row) => row.name === 'Title')!.buttons[0]!.click();
		expect(rows.find((row) => row.name === 'Title')!.text!.getValue()).toBe('Fetched title');
		button('Save').click();
		await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
		expect(service.saveOverrides).toHaveBeenCalledWith(book.filepath, {
			title: null,
			author: 'New author',
		});
		expect(vi.spyOn(modal, 'close')).toHaveBeenCalledOnce();
	});
	it('keeps entered values and the dialog open if saving fails', async () => {
		const service = edits();
		service.saveOverrides.mockRejectedValueOnce(new Error('Disk full'));
		const modal = new EditBookModal(app, book, service as unknown as LibraryEdits, vi.fn());
		modal.onOpen();
		const text = rows.find((row) => row.name === 'Title')!.text!;
		text.simulateInput('Unsaved title');
		button('Save').click();
		await vi.waitFor(() => expect(button('Save').disabled).toBe(false));
		expect(vi.spyOn(modal, 'close')).not.toHaveBeenCalled();
		expect(text.getValue()).toBe('Unsaved title');
		expect(
			(modal.contentEl as unknown as TestElement).all().some((el) => el.text === 'Disk full'),
		).toBe(true);
	});
	it('shows the ISBN merge preview and passes the displayed target when saving', async () => {
		const service = edits();
		service.previewISBN.mockReturnValue({ ...book, isbn13: '9780132350884' });
		const saved = vi.fn();
		const modal = new IdentifyBookModal(
			app,
			'/books/b.pdf',
			'',
			service as unknown as LibraryEdits,
			saved,
		);
		modal.onOpen();
		rows.find((row) => row.name === 'ISBN')!.text!.simulateInput('9780132350884');
		expect(
			(modal.contentEl as unknown as TestElement)
				.all()
				.some((el) => el.text.includes('Saving will merge')),
		).toBe(true);
		button('Save').click();
		await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
		expect(service.assignISBN).toHaveBeenCalledWith(
			'/books/b.pdf',
			'9780132350884',
			'isbn:9780132350884',
		);
	});
	it('allows review and retry when another vault adds the ISBN after the dialog opens', async () => {
		const service = edits();
		const target = { ...book, title: 'New shared entry', ...parseManualISBN('9780132350884') };
		service.assignISBN.mockRejectedValueOnce(new ISBNMergeRequiredError(target));
		const saved = vi.fn();
		const modal = new IdentifyBookModal(
			app,
			'/books/b.pdf',
			'9780132350884',
			service as unknown as LibraryEdits,
			saved,
		);
		modal.onOpen();
		button('Save').click();
		await vi.waitFor(() => expect(button('Save').disabled).toBe(false));
		expect(
			(modal.contentEl as unknown as TestElement)
				.all()
				.some((el) => el.text.includes('“New shared entry”')),
		).toBe(true);
		button('Save').click();
		await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
		expect(service.assignISBN).toHaveBeenLastCalledWith(
			'/books/b.pdf',
			'9780132350884',
			'isbn:9780132350884',
		);
	});
	it('searches candidate titles and paths and keeps included files removed when search clears', async () => {
		const service = edits();
		service.candidates.push({ ...book, filepath: '/other/geometry.pdf', title: 'Geometry' });
		const modal = new AddBooksModal(app, service as unknown as LibraryEdits, vi.fn());
		modal.onOpen();
		const search = rows.find((row) => row.name === 'Search files')!.text!;
		const first = rows.find((row) => row.name === book.title)!;
		const second = rows.find((row) => row.name === 'Geometry')!;
		search.simulateInput(' OTHER Geometry ');
		expect(first.settingEl.hidden).toBe(true);
		expect(second.settingEl.hidden).toBe(false);
		search.simulateInput('missing');
		expect(second.settingEl.hidden).toBe(true);
		expect(
			(modal.contentEl as unknown as TestElement)
				.all()
				.some((el) => !el.hidden && el.text === 'No files match your search.'),
		).toBe(true);
		search.simulateInput('Saved TITLE');
		first.buttons.find((button) => button.buttonText === 'Include')!.click();
		await vi.waitFor(() => expect(first.settingEl.parent).toBeUndefined());
		search.simulateInput('');
		expect(first.settingEl.parent).toBeUndefined();
		expect(second.settingEl.hidden).toBe(false);
	});
	it('requires an explicit include action and leaves failures available to retry', async () => {
		const service = edits();
		service.setIncluded.mockRejectedValueOnce(new Error('Read-only catalog'));
		const modal = new AddBooksModal(app, service as unknown as LibraryEdits, vi.fn());
		modal.onOpen();
		const row = rows.find((row) => row.name === book.title)!;
		expect(service.setIncluded).not.toHaveBeenCalled();
		button('Include').click();
		await vi.waitFor(() => expect(button('Include').disabled).toBe(false));
		expect(row.settingEl.parent).toBeDefined();
		button('Include').click();
		await vi.waitFor(() => expect(row.settingEl.parent).toBeUndefined());
		expect(service.setIncluded).toHaveBeenLastCalledWith('/books/a.pdf', true);
	});
});
