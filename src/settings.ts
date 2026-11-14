import { App, PluginSettingTab } from 'obsidian';
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

	getSettingDefinitions(): SettingDefinitionItem[] {
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
					void this.removeFolder(idx).catch((error) => {
						console.error('Failed to remove watched folder', error);
					});
				},
				items: this.plugin.settings.watchedFolders.map((folder) => ({
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
			void this.addFolder(folderPath);
		});
		modal.open();
	}

	async addFolder(folderPath: string): Promise<void> {
		this.plugin.settings.watchedFolders.push(folderPath);
		await this.plugin.saveData(this.plugin.settings);
		this.update();
	}

	private async removeFolder(index: number): Promise<void> {
		this.plugin.settings.watchedFolders.splice(index, 1);
		await this.plugin.saveData(this.plugin.settings);
		this.update();
	}
}
