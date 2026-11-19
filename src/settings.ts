import { App, Notice, PluginSettingTab } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import MyPlugin from './main';
import { AddFolderModal } from './ui/AddFolderModal';
import { ClearLibraryModal } from './ui/ClearLibraryModal';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isAbsoluteFolderPath } from './utils/folder-path';

export interface DesktopLibrarySettings {
	watchedFolders: Array<string>;
	saveDirectory: string;
	onlineLookupEnabled: boolean;
}

export const DEFAULT_SETTINGS: DesktopLibrarySettings = {
	watchedFolders: Array.of<string>(),
	saveDirectory: homedir(),
	onlineLookupEnabled: false,
};

export class DesktopLibrarySettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	watchFolderChanges(): () => void {
		let previous = JSON.stringify(this.plugin.settings.watchedFolders);
		return this.plugin.library.subscribe(() => {
			const current = JSON.stringify(this.plugin.settings.watchedFolders);
			if (current === previous) return;
			previous = current;
			this.update();
		});
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const watchedFolders = [...this.plugin.settings.watchedFolders];
		return [
			{
				name: 'Online book lookup',
				desc: 'Send ISBNs to Open Library for metadata and Google Books for covers. PDF contents and local paths stay on this device.',
				control: {
					type: 'toggle',
					key: 'onlineLookupEnabled',
					defaultValue: false,
				},
			},
			{
				type: 'list',
				heading: 'Watched folders',
				emptyState: 'No folders being watched yet.',
				addItem: {
					name: 'Add folder',
					action: () => this.openAddFolderModal(),
				},
				onDelete: (idx: number) => {
					const folder = watchedFolders[idx];
					if (folder === undefined) return;
					void this.removeFolder(folder).catch((error) => {
						new Notice('Could not save watched folders. Try again.');
						console.error('Failed to remove watched folder', error);
					});
				},
				items: watchedFolders.map((folder) => ({
					name: folder,
					searchable: false,
				})),
			},
			{
				name: 'Save directory',
				desc: isAbsoluteFolderPath(this.plugin.settings.saveDirectory)
					? `Library data is stored in ${join(this.plugin.settings.saveDirectory, '.obsidian-desktop-shelf')}. Select to change; reload Obsidian to apply.`
					: 'Select the full path to your existing library folder, then reload Obsidian.',
				action: () => this.openSaveDirectoryModal(),
			},
			{
				name: 'Clear library',
				desc: 'Delete the active catalog and cached images. Your PDFs and watched folders are kept. Requires confirmation.',
				action: () => new ClearLibraryModal(this.app, this.plugin).open(),
				disabled: () =>
					!this.plugin.hasValidSaveDirectory || this.plugin.library.isClearing,
			},
		];
	}

	getControlValue(key: string): unknown {
		if (key === 'onlineLookupEnabled') return this.plugin.settings.onlineLookupEnabled;
		return undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'onlineLookupEnabled' && typeof value === 'boolean') {
			this.plugin.settings.onlineLookupEnabled = value;
			await this.plugin.saveSettings();
		}
	}

	openAddFolderModal() {
		const modal = new AddFolderModal(this.app, (folderPath) => this.addFolder(folderPath));
		modal.open();
	}

	openSaveDirectoryModal() {
		new AddFolderModal(
			this.app,
			async (folderPath) => {
				await this.setSaveDirectory(folderPath);
				new Notice('Save directory updated. Reload Obsidian to apply.');
			},
			{
				title: 'Select save directory',
				description:
					'Store the catalog and covers in .obsidian-desktop-shelf inside this folder. Existing data is not moved. To keep your library, copy that subfolder to the new location before reloading Obsidian.',
				pathDescription:
					'Enter the full path to an existing folder. Start typing to see matching folders.',
				submitText: 'Save directory',
				initialPath: this.plugin.settings.saveDirectory,
			},
		).open();
	}

	async setSaveDirectory(folderPath: string): Promise<void> {
		if (!isAbsoluteFolderPath(folderPath)) throw new Error('Enter an absolute folder path.');
		const previous = this.plugin.settings.saveDirectory;
		this.plugin.settings.saveDirectory = folderPath;
		try {
			await this.plugin.saveSettings();
		} catch (error) {
			this.plugin.settings.saveDirectory = previous;
			throw error;
		}
		this.update();
	}

	async addFolder(folderPath: string): Promise<void> {
		await this.plugin.library.setWatchedFolder(folderPath, true);
		this.update();
	}

	private async removeFolder(folder: string): Promise<void> {
		await this.plugin.library.setWatchedFolder(folder, false);
		this.update();
	}
}
