import { BookProps } from '../logic/books/book';

export interface CatalogFile {
	lastUpdated: number; // ms since epoch
	data: Record<string, BookProps>; // keyed by filepath
}
