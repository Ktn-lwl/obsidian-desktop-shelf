import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { App, PluginManifest } from 'obsidian';
import type { CatalogFile } from '../src/model/catalog';
import type { DesktopLibrarySettingTab } from '../src/settings';

const state = vi.hoisted(() => ({
	local: { saveDirectory: '', watchedFolders: Array<string>(), onlineLookupEnabled: false },
	registeredFolders: [] as string[],
	layoutReady: vi.fn(),
	cleanups: [] as Array<() => void>,
}));
vi.mock('obsidian', async (importOriginal) => ({
	...(await importOriginal<typeof import('./mocks/obsidian')>()),
	Plugin: class {
		app = { workspace: { onLayoutReady: state.layoutReady } };
		loadData = async () => state.local;
		addSettingTab(tab: DesktopLibrarySettingTab) {
			state.registeredFolders = [...tab.plugin.settings.watchedFolders];
		}
		register(cleanup: () => void) {
			state.cleanups.push(cleanup);
		}
		registerView() {}
		addCommand() {}
		addRibbonIcon() {}
		addStatusBarItem() {
			return { setText() {} };
		}
	},
}));
vi.mock('../src/ui/LibraryView', () => ({ LibraryView: class {}, LIBRARY_VIEW_TYPE: 'test' }));
vi.mock('../src/ui/native-pdf', () => ({ migratePdfTabs: vi.fn() }));
import DesktopLibrary from '../src/main';

let directory: string;
let catalogPath: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'shelf-startup-'));
	const catalogDir = join(directory, '.obsidian-desktop-shelf');
	await mkdir(catalogDir);
	catalogPath = join(catalogDir, 'Catalog.json');
	state.local = { saveDirectory: directory, watchedFolders: [], onlineLookupEnabled: false };
	state.registeredFolders = [];
	state.layoutReady.mockClear();
});
afterEach(async () => {
	state.cleanups.splice(0).forEach((cleanup) => cleanup());
	await rm(directory, { recursive: true, force: true });
});
describe('plugin startup', () => {
	it('keeps active storage paths until reload, then loads the selected catalog', async () => {
		const plugin = new DesktopLibrary({} as App, {} as PluginManifest);
		await plugin.onload();
		const next = join(directory, 'next');
		const nextCatalogDir = join(next, '.obsidian-desktop-shelf');
		await mkdir(nextCatalogDir, { recursive: true });
		await writeFile(
			join(nextCatalogDir, 'Catalog.json'),
			JSON.stringify({
				lastUpdated: 1,
				data: {},
				settings: { watchedFolders: ['/next/books'] },
			}),
		);
		plugin.settings.saveDirectory = next;
		expect(plugin.catalogPath).toBe(catalogPath);
		expect(plugin.imagesDir).toBe(join(directory, '.obsidian-desktop-shelf', 'covers'));
		plugin.onunload();
		state.local = { ...state.local, saveDirectory: next };
		const reloaded = new DesktopLibrary({} as App, {} as PluginManifest);
		await reloaded.onload();
		expect(reloaded.catalogDir).toBe(nextCatalogDir);
		expect(reloaded.settings.watchedFolders).toEqual(['/next/books']);
		reloaded.onunload();
	});

	it('loads shared folders before registering settings, without waiting for layout or scanning', async () => {
		await writeFile(
			catalogPath,
			JSON.stringify({
				lastUpdated: 1,
				data: {},
				settings: { watchedFolders: ['/shared/books'] },
			}),
		);
		const plugin = new DesktopLibrary({} as App, {} as PluginManifest);
		await plugin.onload();
		expect(state.registeredFolders).toEqual(['/shared/books']);
		expect(state.layoutReady).toHaveBeenCalledOnce();
		expect(plugin.library.issues).toEqual([]);
		plugin.onunload();
	});
	it('migrates legacy local folders on activation even before a scan runs', async () => {
		state.local.watchedFolders = ['/legacy/books'];
		await writeFile(catalogPath, JSON.stringify({ lastUpdated: 1, data: {} }));
		const plugin = new DesktopLibrary({} as App, {} as PluginManifest);
		await plugin.onload();
		const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as CatalogFile;
		expect(catalog.settings?.watchedFolders).toEqual(['/legacy/books']);
		expect(state.registeredFolders).toEqual(['/legacy/books']);
		plugin.onunload();
	});
});
