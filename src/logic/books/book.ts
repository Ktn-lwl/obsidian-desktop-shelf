import { ISBN10, ISBN13 } from '../../model/isbn';

export interface BookProps {
	filepath: string;
	title: string;
	author: string;
	isbn10?: ISBN10;
	isbn13?: ISBN13;
	publisher?: string;
	year?: number;
	coverImgSrc?: string;
}

export class Book {
	private readonly filepath: string;
	private title: string;
	private author: string;
	private isbn10?: ISBN10;
	private isbn13?: ISBN13;
	private publisher?: string;
	private year?: number;
	private coverImgSrc?: string;

	constructor(props: BookProps) {
		this.filepath = props.filepath;
		this.title = props.title;
		this.author = props.author;
		this.isbn10 = props.isbn10;
		this.isbn13 = props.isbn13;
		this.publisher = props.publisher;
		this.year = props.year;
		this.coverImgSrc = props.coverImgSrc;
	}

	setTitle(title: string) {
		this.title = title;
	}

	setAuthor(author: string) {
		this.author = author;
	}

	setISBN10(isbn10: ISBN10) {
		this.isbn10 = isbn10;
	}

	setISBN13(isbn13: ISBN13) {
		this.isbn13 = isbn13;
	}

	setPublisher(publisher: string) {
		this.publisher = publisher;
	}

	setYear(year: number) {
		this.year = year;
	}

	setCoverImgSrc(coverImgSrc: string) {
		this.coverImgSrc = coverImgSrc;
	}

	getFilepath(): string {
		return this.filepath;
	}

	getTitle(): string {
		return this.title;
	}

	getAuthor(): string {
		return this.author;
	}

	getISBN10(): ISBN10 | undefined {
		return this.isbn10;
	}

	getISBN13(): ISBN13 | undefined {
		return this.isbn13;
	}

	getPublisher(): string | undefined {
		return this.publisher;
	}

	getYear(): number | undefined {
		return this.year;
	}

	getCoverImgSrc(): string | undefined {
		return this.coverImgSrc;
	}

	hasISBN(): boolean {
		return this.isbn10 !== undefined || this.isbn13 !== undefined;
	}
}
