import { opendir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Book, BookProps } from './book';
import { ISBNData } from '../../model/isbn';
import { discoverISBNs } from './isbn-extractor';

/**
 * Recursively yield all pdfs contained in a parent directory
 * @param rootDir The parent directory
 */
export async function* getPDFPaths(rootDir: string): AsyncGenerator<string> {
	const contents = await opendir(rootDir);

	for await (const dirent of contents) {
		const fullPath = join(dirent.parentPath, dirent.name);

		if (dirent.isDirectory()) {
			yield* getPDFPaths(fullPath);
		} else if (dirent.isFile() && extname(dirent.name).toLowerCase() === '.pdf') {
			yield fullPath;
		}
	}
}

/**
 * Creates a book from a pdf and returns a book object with the ISBN set, but
 * other metadate uninitialized.
 * @param filePath
 * @returns returns a book object wrapped in a promise or null if no ISBN was found
 */
export async function createBook(filePath: string): Promise<Book | null> {
	const isbns: ISBNData = await discoverISBNs(filePath);

	if (isbns.ISBN10 !== null || isbns.ISBN13 !== null) {
		const props: BookProps = {
			filepath: filePath,
			title: basename(filePath),
			author: 'Unknown',
			isbn10: isbns.ISBN10 ?? undefined,
			isbn13: isbns.ISBN13 ?? undefined,
		};
		return new Book(props);
	}

	return null;
}
