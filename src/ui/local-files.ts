import { stat } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import { Notice, type App } from 'obsidian';
import { shell } from 'electron';
import type { BookProps } from '../logic/books/book';
import { NATIVE_PDF_VIEW_TYPE, NativePdfUnavailableError, resolvePdfFile } from './native-pdf';

async function checkPDF(path: string): Promise<void> {
	if (
		!isAbsolute(path) ||
		extname(path).toLowerCase() !== '.pdf' ||
		!(await stat(path)).isFile()
	) {
		throw new Error('PDF unavailable');
	}
}

export async function openBook(
	app: App,
	book: Pick<BookProps, 'filepath' | 'title'>,
): Promise<void> {
	try {
		await checkPDF(book.filepath);
		const file = resolvePdfFile(app, book.filepath);
		let leaf = app.workspace
			.getLeavesOfType(NATIVE_PDF_VIEW_TYPE)
			.find((leaf) => leaf.getViewState().state?.file === file.path);
		if (!leaf) {
			leaf = app.workspace.getLeaf('tab');
			await leaf.openFile(file, { active: true });
		}
		await app.workspace.revealLeaf(leaf);
	} catch (error) {
		reportFileError(error);
	}
}

export async function showInFolder(path: string): Promise<void> {
	try {
		await checkPDF(path);
		shell.showItemInFolder(path);
	} catch (error) {
		reportFileError(error);
	}
}

function reportFileError(error: unknown): void {
	if (error instanceof NativePdfUnavailableError) {
		new Notice(error.message);
		return;
	}
	new Notice('Could not access this PDF. Check that the file exists and its drive is connected.');
	console.error('Local PDF action failed', error);
}
