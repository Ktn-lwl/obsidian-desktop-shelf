import { Component } from 'obsidian';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import type { BookProps } from '../logic/books/book';
import { loadPdfPreview } from './pdf-preview';

export class BookCard extends Component {
	readonly el: HTMLElement;
	private active = false;
	private objectUrl?: string;
	private started = false;
	private readonly controller = new AbortController();

	constructor(
		parent: HTMLElement,
		readonly book: Readonly<BookProps>,
		private readonly coversDir: string,
		showDetails: () => void,
		openBook: () => void,
		observe: (el: HTMLElement, load: () => void) => () => void,
	) {
		super();
		this.el = parent.createEl('article', { cls: 'desktop-shelf-card' });
		const open = this.el.createEl('button', {
			cls: 'desktop-shelf-open',
			attr: { 'aria-label': `Open ${book.title}` },
		});
		const cover = open.createDiv({ cls: 'desktop-shelf-cover' });
		cover.createSpan({ text: book.title, cls: 'desktop-shelf-placeholder' });
		open.createSpan({ text: book.title, cls: 'desktop-shelf-title' });
		this.el.createDiv({ text: book.author, cls: 'desktop-shelf-author' });
		const details = this.el.createEl('button', {
			text: 'Book details',
			cls: 'desktop-shelf-details',
			attr: { 'aria-label': `Details for ${book.title}` },
		});
		this.registerDomEvent(open, 'click', openBook);
		this.registerDomEvent(details, 'click', showDetails);
		this.register(
			observe(this.el, () => {
				void this.loadCover(cover);
			}),
		);
	}

	onload(): void {
		this.active = true;
	}
	onunload(): void {
		this.active = false;
		this.controller.abort();
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.el.remove();
	}

	private async loadCover(cover: HTMLElement): Promise<void> {
		if (this.started || !this.active) return;
		this.started = true;
		const path = this.book.coverImgSrc;
		if (path) {
			const inside = relative(this.coversDir, path);
			if (
				inside &&
				inside !== '..' &&
				!inside.startsWith(`..${sep}`) &&
				!isAbsolute(inside)
			) {
				try {
					const data = await readFile(path, { signal: this.controller.signal });
					this.showCover(cover, new Uint8Array(data), false);
					return;
				} catch {
					/* Try the PDF when the downloaded cover is missing. */
				}
			}
		}
		await this.loadPreview(cover);
	}

	private async loadPreview(cover: HTMLElement): Promise<void> {
		if (!this.active) return;
		const data = await loadPdfPreview(
			this.book,
			this.coversDir,
			this.controller.signal,
			cover.ownerDocument,
		);
		if (data) this.showCover(cover, data, true);
	}

	private showCover(cover: HTMLElement, data: Uint8Array<ArrayBuffer>, preview: boolean): void {
		if (!this.active) return;
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = URL.createObjectURL(new Blob([data]));
		const img = cover.createEl('img', { attr: { alt: '', decoding: 'async' } });
		this.registerDomEvent(img, 'load', () => cover.addClass('has-cover'));
		this.registerDomEvent(img, 'error', () => {
			img.remove();
			if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = undefined;
			if (!preview) void this.loadPreview(cover);
		});
		img.src = this.objectUrl;
	}
}
