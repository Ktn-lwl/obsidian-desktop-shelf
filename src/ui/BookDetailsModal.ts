import { App, Modal, Setting } from 'obsidian';
import type { BookProps } from '../logic/books/book';
import { openBook, showInFolder } from './local-files';

export class BookDetailsModal extends Modal {
	constructor(
		app: App,
		private readonly book: Readonly<BookProps>,
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
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
