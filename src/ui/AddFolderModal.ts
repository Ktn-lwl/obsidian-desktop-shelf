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
import { join, parse, sep } from 'node:path';
import { isAbsoluteFolderPath } from '../utils/folder-path';

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

		new Setting(this.contentEl)
			.setClass('desktop-shelf-folder-path')
			.setName('Folder path')
			.setDesc(
				options.pathDescription ??
					'Enter the full path to a folder. Its subfolders are scanned automatically.',
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

				txt.setPlaceholder(join(homedir(), sep));
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
		return this.submitting || !isAbsoluteFolderPath(this.folderPath);
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
		const localRoot = parse(homedir()).root;
		const input = sep === '\\' ? query.replaceAll('/', sep) : query;
		const lastSeparator = input.lastIndexOf(sep);
		const searchTerm = input.slice(lastSeparator + 1);
		// A bare prefix searches the local root without resolving it against the working directory.
		const root = input.slice(0, lastSeparator + 1) || localRoot;
		if (!isAbsoluteFolderPath(root)) return [];
		let entries;

		try {
			entries = await readdir(root, { withFileTypes: true });
		} catch {
			return [];
		}

		return entries
			.filter((item) => item.isDirectory() && item.name.startsWith(searchTerm))
			.map((item) => join(root, item.name));
	}

	renderSuggestion(folder: string, el: HTMLElement): void {
		el.setText(folder);
	}

	selectSuggestion(folder: string): void {
		this.textBox.setValue(join(folder, sep));
		this.textBox.inputEl.dispatchEvent(new Event('input'));
	}
}
