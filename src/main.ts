import { Editor, MarkdownView, MarkdownFileInfo, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, DesktopLibrarySettings, DesktopLibrarySettingTab } from './settings';
import { join } from 'node:path';
import { LibraryModal } from './components/LibraryModal';
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

		// This creates an icon in the left ribbon.
		this.addRibbonIcon('library', 'My library', (_evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new LibraryModal(this.app).open();
		});

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status bar text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-modal-simple',
			name: 'Open modal (simple)',
			callback: () => {
				new LibraryModal(this.app).open();
			},
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'replace-selected',
			name: 'Replace selected content',
			editorCallback: (editor: Editor, _ctx: MarkdownView | MarkdownFileInfo) => {
				editor.replaceSelection('Sample editor command');
			},
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-modal-complex',
			name: 'Open modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new LibraryModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: 'refresh-library',
			name: 'Refresh book library',
			callback: () => {
				void this.refreshLibrary().catch((error) => {
					if (!this.unloaded) console.error('Failed to refresh book library', error);
				});
			},
		});

		this.app.workspace.onLayoutReady(() => {
			if (this.unloaded) return;
			void this.refreshLibrary().catch((error) => {
				if (!this.unloaded) console.error('Failed to refresh book library', error);
			});
		});
	}

	onunload() {
		this.unloaded = true;
		this.refreshController.abort();
	}

	private refreshLibrary(): Promise<void> {
		if (this.refreshPromise) return this.refreshPromise;

		this.refreshPromise = this.loadAndRefreshLibrary().finally(() => {
			this.refreshPromise = undefined;
		});
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
