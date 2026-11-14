import { App, Modal, Setting } from 'obsidian';
import type { LibraryEdits } from '../logic/library-edits';
import { IdentifyBookModal } from './IdentifyBookModal';
import { openBook } from './local-files';

export class AddBooksModal extends Modal {
	constructor(
		app: App,
		private readonly edits: LibraryEdits,
		private readonly identified: () => void,
	) {
		super(app);
	}
	onOpen(): void {
		this.contentEl.empty();
		this.setTitle('Add books');
		this.contentEl.createEl('p', {
			text: 'These PDFs have no detected ISBN and are outside your library. Include a file explicitly, or assign an ISBN to identify it.',
		});
		let query = '';
		const entries = new Map<HTMLElement, string>();
		const searchRow = new Setting(this.contentEl).setName('Search files');
		const error = this.contentEl.createDiv({ attr: { role: 'alert' } });
		const empty = this.contentEl.createEl('p', {
			attr: { role: 'status', 'aria-live': 'polite' },
		});
		const updateResults = () => {
			const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
			let matches = 0;
			for (const [el, searchable] of entries) {
				const visible = terms.every((term) => searchable.includes(term));
				el.toggle(visible);
				if (visible) matches++;
			}
			empty.hidden = matches > 0;
			empty.setText(
				entries.size
					? 'No files match your search.'
					: 'No files awaiting inclusion. Refresh to discover files in your watched folders.',
			);
		};
		const removeRow = (el: HTMLElement) => {
			entries.delete(el);
			el.remove();
			updateResults();
		};
		searchRow.addSearch((search) =>
			search.setPlaceholder('Search by title or path…').onChange((value) => {
				query = value;
				updateResults();
			}),
		);
		for (const book of this.edits.candidates) {
			const row = new Setting(this.contentEl)
				.setName(book.title)
				.setDesc(book.filepath)
				.addButton((button) =>
					button.setButtonText('Open PDF').onClick(() => openBook(this.app, book)),
				)
				.addButton((button) =>
					button.setButtonText('Assign ISBN').onClick(() =>
						new IdentifyBookModal(this.app, book.filepath, '', this.edits, () => {
							removeRow(row.settingEl);
							this.identified();
						}).open(),
					),
				)
				.addButton((button) =>
					button
						.setButtonText('Include')
						.setCta()
						.onClick(async () => {
							button.setDisabled(true);
							try {
								await this.edits.setIncluded(book.filepath, true);
								removeRow(row.settingEl);
							} catch (reason) {
								error.setText(
									reason instanceof Error
										? reason.message
										: 'Could not include file. Try again.',
								);
								button.setDisabled(false);
							}
						}),
				);
			entries.set(row.settingEl, `${book.title} ${book.filepath}`.toLocaleLowerCase());
		}
		updateResults();
	}
	onClose(): void {
		this.contentEl.empty();
	}
}
