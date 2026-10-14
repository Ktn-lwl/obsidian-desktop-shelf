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
	metaDataStatus?: MetadataUpdateStatus;
	lastUpdateAttempt?: number;
}

export enum MetadataUpdateStatus {
	SUCCESS = 'success', // no action required
	PENDING = 'pending', // not attempted
	PARTIAL = 'partial', // attempted, partial success due to transient error
	FAILED = 'failed', // attempted, failed due to transient error
	MISSING = 'missing', // attempted, no valid data exists
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
	private metaDataStatus?: MetadataUpdateStatus;
	private lastUpdateAttempt?: number;

	constructor(props: BookProps) {
		this.filepath = props.filepath;
		this.title = props.title;
		this.author = props.author;
		this.isbn10 = props.isbn10;
		this.isbn13 = props.isbn13;
		this.publisher = props.publisher;
		this.year = props.year;
		this.coverImgSrc = props.coverImgSrc;
		this.metaDataStatus = props.metaDataStatus ?? MetadataUpdateStatus.PENDING;
		this.lastUpdateAttempt = props.lastUpdateAttempt ?? Date.now();
	}

	get props(): BookProps {
		return {
			filepath: this.filepath,
			title: this.title,
			author: this.author,
			isbn10: this.isbn10,
			isbn13: this.isbn13,
			publisher: this.publisher,
			year: this.year,
			coverImgSrc: this.coverImgSrc,
			metaDataStatus: this.metaDataStatus,
			lastUpdateAttempt: this.lastUpdateAttempt,
		};
	}

	set Title(title: string) {
		this.title = title;
	}

	set Author(author: string) {
		this.author = author;
	}

	set ISBN10(isbn10: ISBN10) {
		this.isbn10 = isbn10;
	}

	set ISBN13(isbn13: ISBN13) {
		this.isbn13 = isbn13;
	}

	set Publisher(publisher: string) {
		this.publisher = publisher;
	}

	set Year(year: number) {
		this.year = year;
	}

	set CoverImgSrc(coverImgSrc: string) {
		this.coverImgSrc = coverImgSrc;
	}

	set MetaDataUpdateStatus(status: MetadataUpdateStatus) {
		this.metaDataStatus = status;
	}

	set LastUpdateAttempt(time: number) {
		this.lastUpdateAttempt = time;
	}

	get Filepath(): string {
		return this.filepath;
	}

	get Title(): string {
		return this.title;
	}

	get Author(): string {
		return this.author;
	}

	get ISBN10(): ISBN10 | undefined {
		return this.isbn10;
	}

	get ISBN13(): ISBN13 | undefined {
		return this.isbn13;
	}

	get Publisher(): string | undefined {
		return this.publisher;
	}

	get Year(): number | undefined {
		return this.year;
	}

	get CoverImgSrc(): string | undefined {
		return this.coverImgSrc;
	}

	get canUpdate(): boolean {
		return (
			this.metaDataStatus === MetadataUpdateStatus.PENDING ||
			this.metaDataStatus === MetadataUpdateStatus.PARTIAL ||
			this.metaDataStatus === MetadataUpdateStatus.FAILED
		);
	}

	get LastUpdated(): number|undefined {
		return this.lastUpdateAttempt;
	}

	hasISBN(): boolean {
		return this.isbn10 !== undefined || this.isbn13 !== undefined;
	}
}
