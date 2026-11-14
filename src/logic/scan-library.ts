import { stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import type { CatalogFile, ManualState } from '../model/catalog';
import { Book } from './books/book';
import { createBook, getPDFPaths } from './books/directory-crawler';
import { applyIdentification } from './manual-state';
import { throwIfAborted } from '../utils/cancellation';

export async function scanLibrary(
	catalog: Map<string, Book>,
	manual: ManualState,
	scans: NonNullable<CatalogFile['scans']>,
	folders: string[],
	report: (message: string) => void,
	signal?: AbortSignal,
) {
	const problems: string[] = [];
	let discovered = 0;
	const visited = new Set<string>();
	const updatedCatalog = new Map<string, Book>();
	const successfullyScannedFolders: string[] = [];

	for (const folder of folders) {
		throwIfAborted(signal);
		try {
			for await (const filepath of getPDFPaths(folder, signal)) {
				throwIfAborted(signal);
				if (visited.has(filepath)) continue;
				visited.add(filepath);
				report(`Scanning PDFs · ${++discovered} found`);
				try {
					const info = await stat(filepath);
					const previous = catalog.get(filepath);
					const cached = scans[filepath];
					// Legacy records have no fingerprint: seed it without rereading their PDF.
					const unchanged =
						previous &&
						(!cached || (cached.size === info.size && cached.mtimeMs === info.mtimeMs));
					const book = unchanged
						? previous
						: manual.identifications[filepath] && previous
							? previous
							: await createBook(filepath, signal);
					scans[filepath] = { size: info.size, mtimeMs: info.mtimeMs };

					throwIfAborted(signal);
					updatedCatalog.set(filepath, applyIdentification(book, manual));
				} catch (error) {
					throwIfAborted(signal);
					problems.push(`Could not read PDF: ${filepath}`);
					console.error(`Failed to process PDF: ${filepath}`, error);
					const previous = catalog.get(filepath);
					if (previous) updatedCatalog.set(filepath, previous);
				}
			}
			successfullyScannedFolders.push(folder);
		} catch (error) {
			throwIfAborted(signal);
			problems.push(`Could not scan folder: ${folder}`);
			console.error(`Failed to scan watched folder: ${folder}`, error);
		}
	}

	throwIfAborted(signal);
	// Keep successful reads from incomplete traversals; preserve old entries only where
	// no completed traversal proves absence (including overlapping watched folders).
	for (const [filepath, book] of catalog) {
		if (
			!updatedCatalog.has(filepath) &&
			!successfullyScannedFolders.some((folder) => isPathWithinFolder(folder, filepath))
		) {
			updatedCatalog.set(filepath, book);
		}
	}
	return { books: updatedCatalog, successfullyScannedFolders, observedPaths: visited, problems };
}

export function isPathWithinFolder(folder: string, filepath: string): boolean {
	const pathFromFolder = relative(folder, filepath);
	return (
		pathFromFolder !== '..' &&
		!pathFromFolder.startsWith(`..${sep}`) &&
		!isAbsolute(pathFromFolder)
	);
}
