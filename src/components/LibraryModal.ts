import { Modal } from 'obsidian';

export class LibraryModal extends Modal {
	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Pretend something cool happened');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
