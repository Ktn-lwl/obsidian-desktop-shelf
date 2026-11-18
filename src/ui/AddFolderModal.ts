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
import { homedir } from 'node:os';

interface FolderModalOptions {
	title?: string;
	description?: string;
	pathDescription?: string;
	submitText?: string;
	initialPath?: string;
}

export class AddFolderModal extends Modal {
	folderPath: string = '';
	suggestionModal: FolderSuggestions;
	onSubmit: (result: string) => void | Promise<void>;
	private submitting = false;

	constructor(
		app: App,
		onSubmit: (result: string) => void | Promise<void>,
		options: FolderModalOptions = {},
	) {
		super(app);
		this.onSubmit = onSubmit;
		this.folderPath = options.initialPath ?? '';
		this.modalEl.addClass('desktop-shelf-folder-modal');
		this.contentEl.addClass('desktop-shelf-folder');
		this.setTitle(options.title ?? 'Add a folder');
		this.contentEl.createEl('p', {
			cls: 'desktop-shelf-folder-description',
			text:
				options.description ??
				'Watch a local folder for books. Files stay in their original location.',
		});

		let submitButton!: ButtonComponent;
		let textBox!: TextComponent;

		const submit = async () => {
			if (this.submitButtonIsDisabled()) return;
			this.submitting = true;
			submitButton.setDisabled(true);
			try {
				await this.submit();
			} catch (error) {
				new Notice('Could not save folder. Try again.');
				console.error('Failed to save folder', error);
			} finally {
				this.submitting = false;
				submitButton.setDisabled(this.submitButtonIsDisabled());
			}
		};

		//TODO: Case insensitivity
		new Setting(this.contentEl)
			.setClass('desktop-shelf-folder-path')
			.setName('Folder path')
			.setDesc(
				options.pathDescription ??
					'Subfolders are scanned automatically. Start typing to see matching folders.',
			)
			.addText((txt) => {
				txt.setValue(this.folderPath);
				txt.onChange((value: string) => {
					this.folderPath = value.trim();
					submitButton.setDisabled(this.submitButtonIsDisabled());
				});

				txt.inputEl.addEventListener('keydown', (_evt: KeyboardEvent) => {
					if (_evt.key === 'Enter' && !this.submitButtonIsDisabled()) {
						_evt.preventDefault();
						void submit();
					}
				});

				txt.setPlaceholder(`${homedir().replaceAll('\\', '/')}/`);
				txt.inputEl.ariaLabel = 'Folder path';
				txt.inputEl.spellcheck = false;
				textBox = txt;
			});
		new Setting(this.contentEl)
			.setClass('desktop-shelf-folder-actions')
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((btn) => {
				submitButton = btn
					.setButtonText(options.submitText ?? 'Add folder')
					.setCta()
					.onClick(submit)
					.setDisabled(this.submitButtonIsDisabled());
			});

		//Attach a suggestion box
		this.suggestionModal = new FolderSuggestions(this.app, textBox);
	}

	private async submit() {
		const folderPath = this.folderPath;
		if (await this.folderExists(folderPath)) {
			await this.onSubmit(folderPath);
			this.close();
		} else {
			new Notice(`directory: ${folderPath} not found`);
		}
	}

	private submitButtonIsDisabled() {
		return this.submitting || this.folderPath === '';
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
