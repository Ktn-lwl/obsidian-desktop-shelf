import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, DesktopLibrarySettings, DesktopLibrarySettingTab } from './settings';
import { join } from 'node:path';
import { LibraryView, LIBRARY_VIEW_TYPE } from './ui/LibraryView';
import { migratePdfTabs } from './ui/native-pdf';
import { LibraryService } from './logic/LibraryService';
import { isAbsoluteFolderPath } from './utils/folder-path';

export default class DesktopLibrary extends Plugin {
	settings!: DesktopLibrarySettings;
	library!: LibraryService;
	private catalogImported = false;
	private refreshPromise: Promise<void> | undefined;
	private unloaded = false;
	// Keep scans, catalog locks, and cover writes on one location until reload.
	private activeSaveDirectory?: string;
	private readonly refreshController = new AbortController();

	async onload() {
		await this.loadSettings();

		this.library = new LibraryService(this);
		try {
			await this.library.importCatalog();
			this.catalogImported = true;
		} catch (error) {
			new Notice('Could not load shared library settings. Refresh to retry.');
			console.error('Failed to import library on startup', error);
		}
		const settingsTab = new DesktopLibrarySettingTab(this.app, this);
		this.addSettingTab(settingsTab);
		this.register(settingsTab.watchFolderChanges());

		this.registerView(LIBRARY_VIEW_TYPE, (leaf) => new LibraryView(leaf, this));
		const openLibrary = () => {
			void this.openLibrary().catch((error) => {
				new Notice('Could not open the library.');
				console.error(error);
			});
		};
		this.addRibbonIcon('library', 'Open library', openLibrary);
		this.addCommand({ id: 'open-library', name: 'Open library', callback: openLibrary });
		// Preserve existing opening command IDs for saved hotkeys.
		this.addCommand({
			id: 'open-modal-simple',
			name: 'Open library (legacy simple modal)',
			callback: openLibrary,
		});
		this.addCommand({
			id: 'open-modal-complex',
			name: 'Open library (legacy complex modal)',
			callback: openLibrary,
		});
		this.addCommand({
			id: 'refresh-library',
			name: 'Refresh library',
			callback: () => this.refreshLibrary(),
		});
		const status = this.addStatusBarItem();
		status.setText('Library: ready');
		this.register(
			this.library.subscribe(() => status.setText(`Library: ${this.library.status}`)),
		);

		this.app.workspace.onLayoutReady(() => {
			if (this.unloaded) return;
			void migratePdfTabs(this.app, () => this.unloaded);
			void this.refreshLibrary().catch((error) => {
				if (!this.unloaded) console.error('Failed to refresh library', error);
			});
		});
	}

	onunload() {
		this.unloaded = true;
		this.refreshController.abort();
	}

	refreshError?: string;

	get isRefreshing(): boolean {
		return this.refreshPromise !== undefined;
	}

	async openLibrary(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE)[0];
		if (!leaf) {
			leaf = this.app.workspace.getLeaf('tab');
			await leaf.setViewState({ type: LIBRARY_VIEW_TYPE, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	refreshLibrary(): Promise<void> {
		if (this.library.isClearing) return Promise.resolve();
		if (this.refreshPromise) return this.refreshPromise;
		if (this.unloaded) return Promise.resolve();
		this.refreshError = undefined;
		this.refreshPromise = Promise.resolve()
			.then(() => this.loadAndRefreshLibrary())
			.catch((error: unknown) => {
				if (this.unloaded) return;
				this.refreshError =
					error instanceof Error ? error.message : 'Library refresh failed';
				this.library.reportStatus('Refresh failed');
				new Notice('Library refresh failed. Open the library for details.');
				console.error('Failed to refresh library', error);
			})
			.finally(() => {
				this.refreshPromise = undefined;
				if (!this.unloaded) this.library.reportStatus(this.library.status);
			});
		this.library.reportStatus('Loading library…');
		return this.refreshPromise;
	}

	private async loadAndRefreshLibrary(): Promise<void> {
		if (this.unloaded) return;
		if (!this.catalogImported) {
			await this.library.importCatalog();
			this.catalogImported = true;
		}
		if (!this.unloaded) {
			await this.library.updateCatalog(this.refreshController.signal);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			{ ...DEFAULT_SETTINGS, watchedFolders: [] },
			(await this.loadData()) as Partial<DesktopLibrarySettings>,
		);
		this.activeSaveDirectory = this.settings.saveDirectory;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	get hasValidSaveDirectory(): boolean {
		return isAbsoluteFolderPath(this.activeSaveDirectory ?? this.settings.saveDirectory);
	}

	get catalogDir(): string {
		if (!this.hasValidSaveDirectory) {
			throw new Error(
				'Select an absolute save directory in Desktop Shelf settings, then reload.',
			);
		}
		return join(
			this.activeSaveDirectory ?? this.settings.saveDirectory,
			'.obsidian-desktop-shelf',
		);
	}

	get catalogPath(): string {
		return join(this.catalogDir, 'Catalog.json');
	}

	get imagesDir(): string {
		return join(this.catalogDir, 'covers');
	}
}
