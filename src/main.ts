import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, DesktopLibrarySettings, DesktopLibrarySettingTab } from './settings';
import { join } from 'node:path';
import { LibraryView, LIBRARY_VIEW_TYPE } from './ui/LibraryView';
import { migratePdfTabs } from './ui/native-pdf';
import { LibraryService } from './logic/LibraryService';

export default class DesktopLibrary extends Plugin {
	settings!: DesktopLibrarySettings;
	library!: LibraryService;
	private catalogImported = false;
	private refreshPromise: Promise<void> | undefined;
	private unloaded = false;
	private readonly refreshController = new AbortController();

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new DesktopLibrarySettingTab(this.app, this));

		this.library = new LibraryService(this);

		this.registerView(LIBRARY_VIEW_TYPE, (leaf) => new LibraryView(leaf, this));
		const openLibrary = () => {
			void this.openLibrary().catch((error) => {
				new Notice('Could not open the book library.');
				console.error(error);
			});
		};
		this.addRibbonIcon('library', 'Open book library', openLibrary);
		this.addCommand({ id: 'open-library', name: 'Open book library', callback: openLibrary });
		// Preserve existing opening command IDs for saved hotkeys.
		for (const id of ['open-modal-simple', 'open-modal-complex']) {
			this.addCommand({ id, name: 'Open book library (legacy)', callback: openLibrary });
		}
		this.addCommand({
			id: 'refresh-library',
			name: 'Refresh book library',
			callback: () => this.refreshLibrary(),
		});
		const status = this.addStatusBarItem();
		status.setText('Book library: ready');
		this.register(
			this.library.subscribe(() => status.setText(`Book library: ${this.library.status}`)),
		);

		this.app.workspace.onLayoutReady(() => {
			if (this.unloaded) return;
			void migratePdfTabs(this.app, () => this.unloaded);
			void this.refreshLibrary().catch((error) => {
				if (!this.unloaded) console.error('Failed to refresh book library', error);
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
				new Notice('Book library refresh failed. Open the library for details.');
				console.error('Failed to refresh book library', error);
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
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<DesktopLibrarySettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	get catalogDir(): string {
		return join(this.settings.saveDirectory, '.obsidian-desktop-shelf');
	}

	get catalogPath(): string {
		return join(this.catalogDir, 'Catalog.json');
	}

	get imagesDir(): string {
		return join(this.catalogDir, 'covers');
	}
}
