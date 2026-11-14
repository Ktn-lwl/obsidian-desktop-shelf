import { ItemView, WorkspaceLeaf } from 'obsidian';
import type DesktopLibrary from '../main';
import type { BookProps } from '../logic/books/book';
import { BookDetailsModal } from './BookDetailsModal';
import { openBook } from './local-files';
import { BookCard } from './BookCard';
import { selectBooks, type BookSort } from './book-query';
import { AddBooksModal } from './AddBooksModal';
import { bookIdentity } from '../logic/books/book-identity';

export const LIBRARY_VIEW_TYPE = 'desktop-shelf-library';

export class LibraryView extends ItemView {
	private lastBooks?: ReadonlyArray<Readonly<BookProps>>;
	private addBooksButton!: HTMLButtonElement;
	private lastQuery?: string;
	private lastSort?: BookSort;
	private visibleCount = 0;
	private query = '';
	private sort: BookSort = 'title';
	private cards = new Map<string, { signature: string; card: BookCard }>();
	private observer?: IntersectionObserver;
	private coverLoaders = new Map<Element, () => void>();
	private unsubscribe?: () => void;
	private grid!: HTMLElement;
	private status!: HTMLElement;
	private issues!: HTMLElement;
	private empty!: HTMLElement;
	private emptyMessage!: HTMLElement;
	private clearSearch!: HTMLButtonElement;
	private refreshButton!: HTMLButtonElement;
	private updateTimer?: number;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: DesktopLibrary,
	) {
		super(leaf);
	}
	getViewType(): string {
		return LIBRARY_VIEW_TYPE;
	}
	getDisplayText(): string {
		return 'My Library';
	}
	getIcon(): string {
		return 'library';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('desktop-shelf');
		this.contentEl.createEl('h2', { text: 'My Library' });
		const toolbar = this.contentEl.createDiv({ cls: 'desktop-shelf-toolbar' });
		const search = toolbar.createEl('input', {
			type: 'search',
			placeholder: 'Search books…',
			attr: { 'aria-label': 'Search books' },
		});
		search.value = this.query;
		this.registerDomEvent(search, 'input', () => {
			this.query = search.value;
			if (this.updateTimer !== undefined) window.clearTimeout(this.updateTimer);
			this.updateTimer = window.setTimeout(() => this.renderBooks(), 150);
		});
		const sort = toolbar.createEl('select', { attr: { 'aria-label': 'Sort books' } });
		sort.createEl('option', { text: 'Title', value: 'title' });
		sort.createEl('option', { text: 'Author', value: 'author' });
		sort.value = this.sort;
		this.registerDomEvent(sort, 'change', () => {
			this.sort = sort.value === 'author' ? 'author' : 'title';
			this.renderBooks();
		});
		this.addBooksButton = toolbar.createEl('button', { text: 'Add books' });
		this.registerDomEvent(this.addBooksButton, 'click', () =>
			new AddBooksModal(this.app, this.plugin.library.edits, () => {
				void this.plugin.refreshLibrary();
			}).open(),
		);
		this.refreshButton = toolbar.createEl('button', { text: 'Refresh' });
		this.registerDomEvent(this.refreshButton, 'click', () => {
			void this.plugin.refreshLibrary();
		});
		this.status = this.contentEl.createDiv({
			cls: 'desktop-shelf-status',
			attr: { role: 'status', 'aria-live': 'polite' },
		});
		this.issues = this.contentEl.createDiv({ cls: 'desktop-shelf-issues' });
		this.empty = this.contentEl.createDiv({ cls: 'desktop-shelf-empty' });
		this.emptyMessage = this.empty.createEl('p');
		this.clearSearch = this.empty.createEl('button', { text: 'Clear search' });
		this.registerDomEvent(this.clearSearch, 'click', () => {
			this.query = '';
			search.value = '';
			search.focus();
			this.renderBooks();
		});
		this.grid = this.contentEl.createDiv({ cls: 'desktop-shelf-grid' });
		this.observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					this.coverLoaders.get(entry.target)?.();
					this.coverLoaders.delete(entry.target);
					this.observer?.unobserve(entry.target);
				}
			},
			{ root: this.contentEl, rootMargin: '200px' },
		);
		this.unsubscribe = this.plugin.library.subscribe(() => this.renderBooks());
		this.register(() => this.cleanup());
		this.renderBooks();
	}

	async onClose(): Promise<void> {
		this.cleanup();
		this.contentEl.empty();
	}

	private cleanup(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.observer?.disconnect();
		this.coverLoaders.clear();
		if (this.updateTimer !== undefined) window.clearTimeout(this.updateTimer);
		for (const { card } of this.cards.values()) this.removeChild(card);
		this.cards.clear();
		this.lastBooks = undefined;
	}

	private renderBooks(): void {
		const library = this.plugin.library;
		const allBooks = library.books;
		const changed =
			allBooks !== this.lastBooks ||
			this.query !== this.lastQuery ||
			this.sort !== this.lastSort;
		this.addBooksButton.setText(`Add books (${library.edits.candidates.length})`);
		const books = changed ? selectBooks(allBooks, this.query, this.sort) : undefined;
		if (books) this.visibleCount = books.length;
		this.refreshButton.disabled = this.plugin.isRefreshing;
		this.refreshButton.setText(this.plugin.isRefreshing ? 'Refreshing…' : 'Refresh');
		this.status.setText(`${this.visibleCount} of ${allBooks.length} books · ${library.status}`);
		const expanded = this.issues.querySelector('details')?.open ?? false;
		this.issues.empty();
		const issues = library.issues;
		if (this.plugin.refreshError || issues.length) {
			const details = this.issues.createEl('details');
			details.open = expanded;
			details.createEl('summary', {
				text: this.plugin.refreshError ?? `${issues.length} refresh issues`,
			});
			const list = details.createEl('ul');
			for (const issue of issues) list.createEl('li', { text: issue });
			details.createEl('p', {
				text: 'Check folder access and connected drives, then try again.',
			});
		}
		if (!books) return;
		this.lastBooks = allBooks;
		this.lastQuery = this.query;
		this.lastSort = this.sort;
		this.empty.hidden = books.length > 0;
		const hasQuery = this.query.trim().length > 0;
		this.clearSearch.hidden = !hasQuery;
		this.emptyMessage.setText(
			hasQuery
				? 'No books match your search.'
				: this.plugin.settings.watchedFolders.length
					? 'No books yet. Refresh to find ISBN matches, or select Add books to include a PDF.'
					: 'Add a watched folder in Desktop Shelf settings to build your library. Your PDFs stay in their original folders.',
		);
		const paths = new Set(books.map(bookIdentity));
		for (const [path, { card }] of this.cards) {
			if (!paths.has(path)) {
				this.removeChild(card);
				this.cards.delete(path);
			}
		}
		let index = 0;
		for (const book of books) {
			const signature = JSON.stringify(book);
			let entry = this.cards.get(bookIdentity(book));
			if (entry?.signature !== signature) {
				if (entry) this.removeChild(entry.card);
				const card = new BookCard(
					this.grid,
					book,
					this.plugin.imagesDir,
					() =>
						new BookDetailsModal(this.app, book, library.edits, () => {
							void this.plugin.refreshLibrary();
						}).open(),
					() => {
						void openBook(this.app, book);
					},
					(el, load) => {
						this.coverLoaders.set(el, load);
						this.observer?.observe(el);
						return () => {
							this.observer?.unobserve(el);
							this.coverLoaders.delete(el);
						};
					},
				);
				this.addChild(card);
				entry = { signature, card };
				this.cards.set(bookIdentity(book), entry);
			}
			const position = this.grid.children.item(index++);
			if (position !== entry.card.el) this.grid.insertBefore(entry.card.el, position);
		}
	}
}
