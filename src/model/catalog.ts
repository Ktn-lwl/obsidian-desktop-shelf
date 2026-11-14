import { BookProps } from '../logic/books/book';
import type { ISBN10, ISBN13 } from './isbn';

export type EditableMetadata = Pick<BookProps, 'title' | 'author' | 'publisher' | 'year'>;
export type MetadataOverrides = Partial<EditableMetadata>;
export interface ManualState {
	overrides: Record<string, MetadataOverrides>;
	identifications: Record<string, { isbn10?: ISBN10; isbn13?: ISBN13 }>;
	includedFiles: string[];
}

export interface CatalogFile {
	lastUpdated: number; // ms since epoch
	data: Record<string, BookProps>; // keyed by normalized ISBN; legacy unidentified records use paths
	// Scan results awaiting explicit inclusion; never part of the library shelf.
	pendingFiles?: Record<string, BookProps>;
	manual?: ManualState;
	scans?: Record<string, { mtimeMs: number; size: number }>;
}
