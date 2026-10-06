import { readdir, stat } from 'node:fs/promises';
import {
	AbstractInputSuggest,
	App,
	ButtonComponent,
	Modal,
	Notice,
	Setting,
	TextComponent,
} from 'obsidian';

export class AddFolderModal extends Modal {
	folderPath: string = '';
	suggestionModal: FolderSuggestions;
	onSubmit: (result: string) => void;

	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;

		let submitButton!: ButtonComponent;
		let textBox!: TextComponent;

		//TODO: Case insensitivity
		new Setting(this.contentEl)
			.addText((txt) => {
				txt.onChange((value: string) => {
					this.folderPath = value.trim();
					submitButton.setDisabled(this.submitButtonIsDisabled());
				});

				txt.inputEl.addEventListener('keydown', (_evt: KeyboardEvent) => {
					if (_evt.key === 'Enter' && !this.submitButtonIsDisabled()) {
						_evt.preventDefault();
						this.submit().catch((error) => {
							new Notice(`Failed to add folder.`);
							console.error(error);
						});
					}
				});

				txt.setPlaceholder('/path/to/directory/');
				textBox = txt;
			})
			.addButton((btn) => {
				submitButton = btn
					.setButtonText('Add folder')
					.onClick(() => this.submit())
					.setDisabled(this.submitButtonIsDisabled());
			});

		//Attach a suggestion box
		this.suggestionModal = new FolderSuggestions(this.app, textBox);
	}

	private async submit() {
		if (await this.folderExists(this.folderPath)) {
			this.onSubmit(this.folderPath);
			this.close();
		} else {
			new Notice(`directory: ${this.folderPath} not found`);
		}
	}

	private submitButtonIsDisabled() {
		return this.folderPath === '';
	}

	private async folderExists(path: string) {
		try {
			return (await stat(path)).isDirectory();
		} catch {
			return false;
		}
	}

	onClose(): void {
		this.suggestionModal.close();
		super.onClose();
	}
}

class FolderSuggestions extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private textBox: TextComponent,
	) {
		super(app, textBox.inputEl);
		this.textBox = textBox;
	}

	protected async getSuggestions(query: string): Promise<string[]> {
		// determine current root
		const dirs = query.split('/');
		const root = dirs.slice(0, -1).join('/') || '/';
		const searchTerm = dirs.length > 1 ? dirs.last()! : '';
		let entries;

		try {
			entries = await readdir(root, { withFileTypes: true });
		} catch {
			return [];
		}

		const suggestions = entries.filter((item) => item.isDirectory()).map((item) => item.name);

		return (await this.fuzzyFilter(searchTerm, suggestions)).map(
			(item) => `${root}${root !== '/' ? '/' : ''}${item}`,
		);
	}

	renderSuggestion(folder: string, el: HTMLElement): void {
		el.setText(folder);
	}

	selectSuggestion(folder: string): void {
		this.textBox.setValue(`${folder}/`);
		this.textBox.inputEl.dispatchEvent(new Event('input'));
	}

	//TODO: Uses basic string matching. Will switch to Levenshtein
	async fuzzyFilter(query: string, candidates: string[]): Promise<string[]> {
		return candidates.filter((text) => text.startsWith(query));
	}
}
