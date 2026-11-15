import type { CatalogFile } from '../model/catalog';

/** Missing settings denote a legacy catalog; an explicit empty list stays empty. */
export function catalogWatchedFolders(catalog: CatalogFile): string[] | undefined {
	if (catalog.settings === undefined) return undefined;
	const folders = catalog.settings?.watchedFolders;
	if (!Array.isArray(folders) || folders.some((folder) => typeof folder !== 'string')) {
		throw new Error('Catalog watched folders have an invalid format.');
	}
	return [...new Set(folders)];
}

export function ensureCatalogSettings(
	catalog: CatalogFile,
	legacyFolders: readonly string[],
): NonNullable<CatalogFile['settings']> {
	const folders = catalogWatchedFolders(catalog) ?? [...new Set(legacyFolders)];
	return (catalog.settings = { ...catalog.settings, watchedFolders: folders });
}
