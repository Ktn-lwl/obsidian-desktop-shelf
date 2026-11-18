import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, ButtonComponent, Notice } from '../mocks/obsidian';
import type DesktopLibrary from '../../src/main';
import { ClearLibraryModal } from '../../src/ui/ClearLibraryModal';

beforeEach(() => {
	vi.clearAllMocks();
	ButtonComponent.instances = [];
});

function setup(clearLibrary = vi.fn(async () => {})) {
	const plugin = {
		catalogDir: '/active/.obsidian-desktop-shelf',
		library: { clearLibrary },
	} as unknown as DesktopLibrary;
	const modal = new ClearLibraryModal(new App(), plugin);
	return { close: vi.spyOn(modal, 'close'), clearLibrary };
}

describe('clear library confirmation', () => {
	it('requires explicit confirmation and allows cancellation without deleting data', () => {
		const { close, clearLibrary } = setup();
		expect(clearLibrary).not.toHaveBeenCalled();
		ButtonComponent.instances.find((button) => button.buttonText === 'Cancel')!.click();
		expect(clearLibrary).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledOnce();
	});

	it('confirms deletion and closes only after it succeeds', async () => {
		const { close, clearLibrary } = setup();
		ButtonComponent.instances.find((button) => button.buttonText === 'Clear library')!.click();
		await vi.waitFor(() =>
			expect(Notice).toHaveBeenCalledWith(
				'Library cleared. Your original files are unchanged.',
			),
		);
		expect(clearLibrary).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
	});

	it('keeps the confirmation open for retry when clearing fails', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { close } = setup(vi.fn().mockRejectedValue(new Error('Access denied')));
		const button = ButtonComponent.instances.find(
			(item) => item.buttonText === 'Clear library',
		)!;
		button.click();
		await vi.waitFor(() => expect(button.disabled).toBe(false));
		expect(close).not.toHaveBeenCalled();
		expect(Notice).toHaveBeenCalled();
		log.mockRestore();
	});
});
