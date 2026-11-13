import { Notice, type App, type TFile } from 'obsidian';
import { extname, isAbsolute, relative, sep } from 'node:path';

export const NATIVE_PDF_VIEW_TYPE = 'pdf';
const LEGACY_PDF_VIEW_TYPE = 'desktop-shelf-pdf';

/**
 * Obsidian 1.14.2+ resolves external files via `file:` followed by a raw path.
 * This is an internal path convention, NOT a percent-encoded file URL.
 * Keep it here so a future API change has a single compatibility boundary.
 * The returned real TFile lets Obsidian own rendering, watching and tab state.
 */
export function resolvePdfFile(app: App, filepath: string): TFile {
	const adapter = app.vault.adapter as typeof app.vault.adapter & {
		getBasePath?: () => unknown;
	};
	if (typeof adapter.getBasePath === 'function') {
		const base: unknown = adapter.getBasePath();
		if (typeof base === 'string') {
			const path = relative(base, filepath);
			if (path && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)) {
				const file = app.vault.getFileByPath(path.split(sep).join('/'));
				if (file) return file;
			}
		}
	}
	const file = app.vault.getFileByPath(`file:${filepath.replace(/\\/g, '/')}`);
	if (!file) throw new NativePdfUnavailableError();
	return file;
}

export class NativePdfUnavailableError extends Error {
	constructor() {
		super('Native external PDF support is unavailable. Update Obsidian to 1.14.2 or newer.');
	}
}

/** Preserve old workspace entries without keeping a second PDF implementation. */
export async function migratePdfTabs(app: App, stopped: () => boolean): Promise<void> {
	for (const leaf of app.workspace.getLeavesOfType(LEGACY_PDF_VIEW_TYPE)) {
		if (stopped()) return;
		const state = leaf.getViewState().state;
		if (
			typeof state?.file !== 'string' ||
			!isAbsolute(state.file) ||
			extname(state.file).toLowerCase() !== '.pdf'
		)
			continue;
		try {
			const file = resolvePdfFile(app, state.file);
			const page = state.page;
			const eState =
				typeof page === 'number' && Number.isFinite(page) && page >= 1
					? { subpath: `#page=${Math.floor(page)}` }
					: {};
			await leaf.openFile(file, { active: false, eState });
		} catch (error) {
			new Notice(
				'Could not restore a book tab. Reopen it from the library when its file is available.',
			);
			console.error('Failed to migrate PDF tab', error);
		}
	}
}
