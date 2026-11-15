import { App, Notice, PluginSettingTab } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import MyPlugin from './main';
import { AddFolderModal } from './components/AddFolderModal';
import { homedir } from 'node:os';

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
		const modal = new AddFolderModal(this.app, (folderPath): void => {
			void this.addFolder(folderPath).catch((error) => {
				new Notice('Could not save watched folders. Try again.');
				console.error('Failed to add watched folder', error);
			});
		});
		modal.open();
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
