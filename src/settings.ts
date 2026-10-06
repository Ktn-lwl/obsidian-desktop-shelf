import { App, PluginSettingTab } from 'obsidian';
import MyPlugin from './main';
import { AddFolderModal } from './components/AddFolderModal';

export interface DesktopLibrarySettings {
	watchedFolders: Array<string>;
}

export const DEFAULT_SETTINGS: DesktopLibrarySettings = {
	watchedFolders: Array.of<string>(),
};

export class DesktopLibrarySettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions() {
		return [
			{
				type: 'list' as const,
				heading: 'Watched folders',
				emptyState: 'No folders being watched yet.',
				addItem: {
					name: 'Add Folder',
					action: () => this.openAddFolderModal(),
				},
				onDelete: async (idx: number) => {
					this.plugin.settings.watchedFolders.splice(idx, 1);
					await this.plugin.saveData(this.plugin.settings);
					this.update();
				},
				items: this.plugin.settings.watchedFolders.map((folder) => ({
					name: folder,
					searchable: false,
				})),
			},
		];
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
}
