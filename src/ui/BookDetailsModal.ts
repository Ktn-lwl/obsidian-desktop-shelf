import { App, Modal, Setting } from 'obsidian';
import type { BookProps } from '../logic/books/book';
import { openBook, showInFolder } from './local-files';
import type { LibraryEdits } from '../logic/library-edits';
import { EditBookModal } from './EditBookModal';
import { IdentifyBookModal } from './IdentifyBookModal';

export class BookDetailsModal extends Modal {
	constructor(
		app: App,
		private readonly book: Readonly<BookProps>,
		private readonly edits?: LibraryEdits,
		private readonly identified?: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.book.title);
		const fields = [
			['Author', this.book.author],
			['ISBN', this.book.isbn13 ?? this.book.isbn10],
			['Publisher', this.book.publisher],
			['Year', this.book.year?.toString()],
			['Metadata', this.book.metaDataStatus],
		];
		for (const [label, value] of fields) {
			if (label && value) new Setting(this.contentEl).setName(label).setDesc(value);
		}
		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText('Open PDF')
				.setCta()
				.onClick(() => openBook(this.app, this.book)),
		);
		if (this.edits)
			new Setting(this.contentEl).addButton((button) =>
				button
					.setButtonText('Edit details')
					.onClick(() =>
						new EditBookModal(this.app, this.book, this.edits!, () =>
							this.close(),
						).open(),
					),
			);
		const error = this.contentEl.createDiv({ attr: { role: 'alert' } });
		for (const filepath of this.book.filepaths ?? [this.book.filepath]) {
			new Setting(this.contentEl)
				.setName('File')
				.setDesc(filepath)
				.addButton((button) =>
					button
						.setButtonText('Open copy')
						.onClick(() => openBook(this.app, { filepath, title: this.book.title })),
				)
				.addButton((button) =>
					button.setButtonText('Show in folder').onClick(() => showInFolder(filepath)),
				);
			if (this.edits)
				new Setting(this.contentEl)
					.setName('Manage this copy')
					.setDesc(filepath)
					.addButton((button) =>
						button
							.setButtonText(
								this.book.isbn13 || this.book.isbn10
									? 'Correct ISBN'
									: 'Assign ISBN',
							)
							.onClick(() =>
								new IdentifyBookModal(
									this.app,
									filepath,
									this.book.isbn13 ?? this.book.isbn10 ?? '',
									this.edits!,
									() => {
										this.close();
										this.identified?.();
									},
								).open(),
							),
					);
			if (this.edits && !this.book.isbn10 && !this.book.isbn13) {
				new Setting(this.contentEl)
					.setName('Library inclusion')
					.setDesc(filepath)
					.addButton((button) =>
						button
							.setButtonText('Remove from library')
							.setTooltip('Keep the PDF and its cached scan result')
							.onClick(async () => {
								button.setDisabled(true);
								try {
									await this.edits!.setIncluded(filepath, false);
									this.close();
								} catch (reason) {
									error.setText(
										reason instanceof Error
											? reason.message
											: 'Could not remove inclusion. Try again.',
									);
									button.setDisabled(false);
								}
							}),
					);
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
