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
