import { App, Modal, Setting } from 'obsidian';
import { ISBNMergeRequiredError, type LibraryEdits } from '../logic/library-edits';
import { bookIdentity } from '../logic/books/book-identity';
import type { BookProps } from '../logic/books/book';

export class IdentifyBookModal extends Modal {
	constructor(
		app: App,
		private readonly path: string,
		private readonly initialISBN: string,
		private readonly edits: LibraryEdits,
		private readonly saved: () => void,
	) {
		super(app);
	}
	onOpen(): void {
		this.setTitle(this.initialISBN ? 'Correct ISBN' : 'Assign ISBN');
		new Setting(this.contentEl).setName('File').setDesc(this.path);
		let input = this.initialISBN;
		let merge: string | undefined;
		const preview = this.contentEl.createEl('p', {
			attr: { role: 'status', 'aria-live': 'polite' },
		});
		const error = this.contentEl.createDiv({ attr: { role: 'alert' } });
		const showMerge = (book: Readonly<BookProps>) => {
			merge = bookIdentity(book);
			preview.setText(
				`Saving will merge this copy into “${book.title}”. All file locations will be kept.`,
			);
		};
		const updatePreview = () => {
			merge = undefined;
			try {
				const book = this.edits.previewISBN(this.path, input);
				if (book) {
					showMerge(book);
				} else
					preview.setText(
						'This identifier applies to this copy. Other copies keep their current identifier.',
					);
			} catch {
				preview.setText('Enter a valid identifier to continue.');
			}
		};
		new Setting(this.contentEl).setName('ISBN').addText((text) =>
			text
				.setValue(input)
				.setPlaceholder('10 or 13 digits')
				.onChange((value) => {
					input = value;
					error.setText('');
					updatePreview();
				}),
		);
		updatePreview();
		new Setting(this.contentEl)
			.addButton((button) =>
				button
					.setButtonText('Save')
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						try {
							await this.edits.assignISBN(this.path, input, merge);
							this.saved();
							this.close();
						} catch (reason) {
							if (reason instanceof ISBNMergeRequiredError) showMerge(reason.book);
							else updatePreview();
							error.setText(
								reason instanceof Error
									? reason.message
									: 'Could not save ISBN. Try again.',
							);
						} finally {
							button.setDisabled(false);
						}
					}),
			)
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
	}
	onClose(): void {
		this.contentEl.empty();
	}
}
