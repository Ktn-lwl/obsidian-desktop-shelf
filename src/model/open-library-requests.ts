export interface OpenLibrarySearchResponse {
	docs?: OpenLibrarySearchResult[];
}

export interface OpenLibrarySearchResult {
	title?: string;
	subtitle?: string;
	author_name?: string[];
	publisher?: string[];
	first_publish_year?: number;
	number_of_pages_median?: number;
}
