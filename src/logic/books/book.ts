import { type ISBN10, type ISBN13, normalizeISBN10, normalizeISBN13 } from '../../model/isbn';
import { BookMetadata } from '../../model/metadata';

export interface BookProps {
	filepath: string;
	filepaths?: readonly string[];
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
	private readonly data: BookProps;

	constructor(props: BookProps) {
		this.data = {
			...props,
			isbn10: normalizeISBN10(props.isbn10),
			isbn13: normalizeISBN13(props.isbn13),
			filepaths: props.filepaths && Object.freeze([...props.filepaths]),
			metaDataStatus: props.metaDataStatus ?? MetadataUpdateStatus.PENDING,
			lastUpdateAttempt: props.lastUpdateAttempt ?? Date.now(),
		};
	}

	get props(): BookProps {
		return { ...this.data };
	}

	set Title(title: string) {
		this.data.title = title;
	}

	set CoverImgSrc(coverImgSrc: string) {
		this.data.coverImgSrc = coverImgSrc;
	}

	set MetaDataUpdateStatus(status: MetadataUpdateStatus) {
		this.data.metaDataStatus = status;
	}

	set LastUpdateAttempt(time: number) {
		this.data.lastUpdateAttempt = time;
	}

	get Filepath(): string {
		return this.data.filepath;
	}

	get Title(): string {
		return this.data.title;
	}

	get Author(): string {
		return this.data.author;
	}

	get ISBN10(): ISBN10 | undefined {
		return this.data.isbn10;
	}

	get ISBN13(): ISBN13 | undefined {
		return this.data.isbn13;
	}

	get Year(): number | undefined {
		return this.data.year;
	}

	get canUpdate(): boolean {
		return (
			this.data.metaDataStatus === MetadataUpdateStatus.PENDING ||
			this.data.metaDataStatus === MetadataUpdateStatus.PARTIAL ||
			this.data.metaDataStatus === MetadataUpdateStatus.FAILED
		);
	}

	get LastUpdated(): number | undefined {
		return this.data.lastUpdateAttempt;
	}

	update(metadata: BookMetadata): void {
		this.data.title = metadata.title;
		if (metadata.authors.length > 0) {
			this.data.author = metadata.authors.join(', ');
		}

		const year = metadata.publishedDate?.match(/^\d{4}/)?.[0];
		if (year) this.data.year = Number(year);
		if (metadata.publisher) this.data.publisher = metadata.publisher;
	}

	hasISBN(): boolean {
		return this.data.isbn10 !== undefined || this.data.isbn13 !== undefined;
	}
}
