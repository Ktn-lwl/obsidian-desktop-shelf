export interface BookMetadata {
	title: string;
	subtitle?: string;
	authors: string[];
	publisher?: string;
	publishedDate?: string;
	description?: string;
	pageCount?: number;
	coverUrl?: string;
}
