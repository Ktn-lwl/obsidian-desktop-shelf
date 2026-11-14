import { App, Modal, Setting, type ButtonComponent, type TextComponent } from 'obsidian';
import type { BookProps } from '../logic/books/book';
import type { MetadataOverrides } from '../model/catalog';
import { bookIdentity } from '../logic/books/book-identity';
import type { LibraryEdits } from '../logic/library-edits';

export class EditBookModal extends Modal {
	constructor(
		app: App,
		private readonly book: Readonly<BookProps>,
		private readonly edits: LibraryEdits,
		private readonly saved: () => void,
	) {
		super(app);
	}
	onOpen(): void {
		this.setTitle('Edit details');
		const identity = bookIdentity(this.book);
		const overrides = this.edits.getOverrides(identity);
		const base = this.edits.getBaseBook(this.book.filepath);
		const patch: Partial<Record<keyof MetadataOverrides, string | number | null>> = {};
		const error = this.contentEl.createDiv({ attr: { role: 'alert' } });
		const controls: Array<ButtonComponent | TextComponent> = [];
		for (const [field, label] of [
			['title', 'Title'],
			['author', 'Author'],
			['publisher', 'Publisher'],
			['year', 'Publication year'],
		] as const) {
			const initial = this.book[field]?.toString() ?? '';
			const row = new Setting(this.contentEl).setName(label);
			row.setDesc(
				overrides[field] === undefined
					? 'Using scanned or online details.'
					: 'Using your saved edit.',
			);
			row.addText((text) => {
				controls.push(text);
				text.setValue(initial).onChange((value) => {
					if (value === initial) delete patch[field];
					else
						patch[field] =
							field === 'year' ? (value.trim() ? Number(value) : null) : value;
				});
				if (field === 'year') text.inputEl.inputMode = 'numeric';
				row.addButton((button) => {
					controls.push(button);
					button
						.setButtonText('Reset')
						.setTooltip('Use scanned or online details')
						.onClick(() => {
							patch[field] = null;
							text.setValue(base?.[field]?.toString() ?? '');
							row.setDesc('Will use scanned or online details after saving.');
						});
				});
			});
		}
		new Setting(this.contentEl)
			.addButton((button) => {
				controls.push(button);
				button
					.setButtonText('Save')
					.setCta()
					.onClick(async () => {
						controls.forEach((control) => {
							control.setDisabled(true);
						});
						error.setText('');
						try {
							await this.edits.saveOverrides(identity, patch);
							this.saved();
							this.close();
						} catch (reason) {
							error.setText(
								reason instanceof Error
									? reason.message
									: 'Could not save details. Try again.',
							);
						} finally {
							controls.forEach((control) => {
								control.setDisabled(false);
							});
						}
					});
			})
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
	}
	onClose(): void {
		this.contentEl.empty();
	}
}
