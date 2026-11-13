import { Component } from 'obsidian';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import type { BookProps } from '../logic/books/book';

export class BookCard extends Component {
	readonly el: HTMLElement;
	private active = false;
	private objectUrl?: string;

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
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.el.remove();
	}

	private async loadCover(cover: HTMLElement): Promise<void> {
		const path = this.book.coverImgSrc;
		if (!path) return;
		const inside = relative(this.coversDir, path);
		if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
			return;
		try {
			const data = await readFile(path);
			if (!this.active) return;
			this.objectUrl = URL.createObjectURL(new Blob([new Uint8Array(data)]));
			const img = cover.createEl('img', {
				attr: { alt: '', decoding: 'async' },
			});
			this.registerDomEvent(img, 'load', () => cover.addClass('has-cover'));
			this.registerDomEvent(img, 'error', () => img.remove());
			img.src = this.objectUrl;
		} catch {
			/* Keep the title placeholder if the cached cover is unavailable. */
		}
	}
}
