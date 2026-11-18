import { App, Modal, Notice, Setting } from 'obsidian';
import type DesktopLibrary from '../main';

export class ClearLibraryModal extends Modal {
	constructor(app: App, plugin: DesktopLibrary) {
		super(app);
		this.setTitle('Clear library?');
		this.contentEl.createEl('p', {
			text: 'Permanently delete the catalog, manual edits, downloaded covers, and PDF previews from the active save directory. Your original files and watched folders are kept. Refresh rebuilds the library. This cannot be undone.',
		});
		this.contentEl.createEl('p', { text: `Active library: ${plugin.catalogDir}` });
		this.contentEl.createEl('p', {
			text: 'If other vaults use this library, close them first so they cannot restore cached data.',
		});
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((button) => {
				button
					.setButtonText('Clear library')
					.setDestructive()
					.onClick(async () => {
						button.setDisabled(true);
						try {
							await plugin.library.clearLibrary();
							new Notice('Library cleared. Your original files are unchanged.');
							this.close();
						} catch (error) {
							new Notice(
								'Could not clear the library completely. Check folder access and try again.',
							);
							console.error('Failed to clear library', error);
							button.setDisabled(false);
						}
					});
			});
	}
}
