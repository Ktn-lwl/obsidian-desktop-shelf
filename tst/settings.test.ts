import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import type DesktopLibrary from '../src/main';
import { DEFAULT_SETTINGS, DesktopLibrarySettingTab } from '../src/settings';

describe('online lookup consent', () => {
	it('defaults to offline and persists an explicit opt-in and opt-out', async () => {
		const saveSettings = vi.fn(async () => {});
		const plugin = {
			settings: { ...DEFAULT_SETTINGS },
			saveSettings,
		} as unknown as DesktopLibrary;
		const tab = new DesktopLibrarySettingTab(new App(), plugin);
		expect(tab.getControlValue('onlineLookupEnabled')).toBe(false);
		await tab.setControlValue('onlineLookupEnabled', true);
		expect(plugin.settings.onlineLookupEnabled).toBe(true);
		await tab.setControlValue('onlineLookupEnabled', false);
		expect(plugin.settings.onlineLookupEnabled).toBe(false);
		expect(saveSettings).toHaveBeenCalledTimes(2);
	});

	it('rejects non-boolean consent values', async () => {
		const saveSettings = vi.fn();
		const plugin = {
			settings: { ...DEFAULT_SETTINGS },
			saveSettings,
		} as unknown as DesktopLibrary;
		const tab = new DesktopLibrarySettingTab(new App(), plugin);
		await tab.setControlValue('onlineLookupEnabled', 'true');
		expect(plugin.settings.onlineLookupEnabled).toBe(false);
		expect(saveSettings).not.toHaveBeenCalled();
	});
});

describe('shared watched folder controls', () => {
	it('saves folder additions through the catalog service', async () => {
		const setWatchedFolder = vi.fn(async () => {});
		const plugin = {
			settings: { ...DEFAULT_SETTINGS, watchedFolders: [] },
			library: { setWatchedFolder },
		} as unknown as DesktopLibrary;
		const tab = new DesktopLibrarySettingTab(new App(), plugin);
		const update = vi.fn();
		tab.update = update;
		await tab.addFolder('/books');
		expect(setWatchedFolder).toHaveBeenCalledWith('/books', true);
		expect(update).toHaveBeenCalledOnce();
	});

	it('keeps the displayed folders when saving an addition fails', async () => {
		const plugin = {
			settings: { ...DEFAULT_SETTINGS, watchedFolders: ['/existing'] },
			library: { setWatchedFolder: vi.fn().mockRejectedValue(new Error('Disk full')) },
		} as unknown as DesktopLibrary;
		const tab = new DesktopLibrarySettingTab(new App(), plugin);
		const update = vi.fn();
		tab.update = update;
		await expect(tab.addFolder('/new')).rejects.toThrow('Disk full');
		expect(plugin.settings.watchedFolders).toEqual(['/existing']);
		expect(update).not.toHaveBeenCalled();
	});
});

describe('catalog changes while settings are open', () => {
	it('refreshes the folder list only when it changes and unregisters cleanly', () => {
		const listeners = new Set<() => void>();
		const plugin = {
			settings: { ...DEFAULT_SETTINGS, watchedFolders: [] as string[] },
			library: {
				subscribe(listener: () => void) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
			},
		} as unknown as DesktopLibrary;
		const tab = new DesktopLibrarySettingTab(new App(), plugin);
		const update = vi.fn();
		tab.update = update;
		const stop = tab.watchFolderChanges();
		listeners.forEach((notify) => notify());
		expect(update).not.toHaveBeenCalled();
		plugin.settings.watchedFolders = ['/shared/books'];
		listeners.forEach((notify) => notify());
		expect(update).toHaveBeenCalledOnce();
		plugin.settings.watchedFolders = ['/shared/books'];
		listeners.forEach((notify) => notify());
		expect(update).toHaveBeenCalledOnce();
		stop();
		expect(listeners.size).toBe(0);
	});
});
