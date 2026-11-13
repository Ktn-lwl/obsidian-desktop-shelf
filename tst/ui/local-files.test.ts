import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { shell } from 'electron';
import { Notice, type App } from 'obsidian';
import { openBook, showInFolder } from '../../src/ui/local-files';
import { NativePdfUnavailableError, resolvePdfFile, migratePdfTabs } from '../../src/ui/native-pdf';

let directory: string | undefined;
afterEach(async () => {
	if (directory) await rm(directory, { recursive: true, force: true });
	directory = undefined;
	vi.restoreAllMocks();
	vi.clearAllMocks();
});
async function makePDF(): Promise<string> {
	directory = await mkdtemp(join(tmpdir(), 'shelf-open-'));
	const path = join(directory, 'A book #1.pdf');
	await writeFile(path, 'test');
	return path;
}
function workspace() {
	const leaf = {
		openFile: vi.fn(async () => {}),
		setViewState: vi.fn(async () => {}),
		getViewState: () => ({ state: {} as Record<string, unknown> }),
	};
	const workspace = {
		getLeaf: vi.fn(() => leaf),
		getLeavesOfType: vi.fn(() => [] as (typeof leaf)[]),
		revealLeaf: vi.fn(async () => {}),
	};
	const vault = {
		adapter: {},
		getFileByPath: vi.fn((path: string): { path: string; extension: string } | null => ({
			path,
			extension: 'pdf',
		})),
	};
	return { app: { workspace, vault } as unknown as App, workspace, leaf, vault };
}

describe('local PDF actions', () => {
	it('opens another copy when the preferred location is unavailable', async () => {
		const path = await makePDF();
		const { app, leaf } = workspace();
		await openBook(app, {
			filepath: join(directory!, 'missing.pdf'),
			filepaths: [join(directory!, 'missing.pdf'), path],
			title: 'A book',
		});
		expect(leaf.openFile).toHaveBeenCalledWith(
			{ path: `file:${path}`, extension: 'pdf' },
			{ active: true },
		);
		expect(Notice).not.toHaveBeenCalled();
	});
	it('reuses a tab showing a different available copy of the same book', async () => {
		const path = await makePDF();
		const other = join(directory!, 'other.pdf');
		await writeFile(other, 'cached');
		const { app, workspace: ws, leaf } = workspace();
		leaf.getViewState = () => ({ state: { file: `file:${other}` } });
		ws.getLeavesOfType.mockReturnValue([leaf]);
		await openBook(app, { filepath: path, filepaths: [path, other], title: 'A book' });
		expect(ws.getLeaf).not.toHaveBeenCalled();
		expect(ws.revealLeaf).toHaveBeenCalledWith(leaf);
	});
	it('opens external PDFs in a reader tab with the exact local path', async () => {
		const path = await makePDF();
		const { app, workspace: ws, leaf } = workspace();
		await openBook(app, { filepath: path, title: 'A book' });
		expect(leaf.openFile).toHaveBeenCalledWith(
			{ path: `file:${path}`, extension: 'pdf' },
			{ active: true },
		);
		expect(ws.revealLeaf).toHaveBeenCalledWith(leaf);
		expect(Notice).not.toHaveBeenCalled();
	});
	it('reuses an already-open PDF without resetting its page', async () => {
		const path = await makePDF();
		const { app, workspace: ws, leaf } = workspace();
		leaf.getViewState = () => ({ state: { file: `file:${path}`, page: 12 } });
		ws.getLeavesOfType.mockReturnValue([leaf]);
		await openBook(app, { filepath: path, title: 'A book' });
		expect(ws.getLeaf).not.toHaveBeenCalled();
		expect(leaf.openFile).not.toHaveBeenCalled();
		expect(ws.revealLeaf).toHaveBeenCalledWith(leaf);
	});
	it('reveals an existing PDF in its folder', async () => {
		const path = await makePDF();
		await showInFolder(path);
		expect(shell.showItemInFolder).toHaveBeenCalledWith(path);
	});
	it('reports missing files and refuses non-PDF catalog entries', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const path = await makePDF();
		const { app, workspace: ws } = workspace();
		await openBook(app, { filepath: join(directory!, 'missing.pdf'), title: 'Missing' });
		const nonPDF = path.replace('.pdf', '.exe');
		await writeFile(nonPDF, 'test');
		await openBook(app, { filepath: nonPDF, title: 'Invalid' });
		expect(ws.getLeaf).not.toHaveBeenCalled();
		expect(Notice).toHaveBeenCalledTimes(2);
	});
});

describe('native PDF compatibility adapter', () => {
	it('passes spaces, Unicode, # and % literally rather than URL encoding', () => {
		const { app, vault } = workspace();
		const path = '/books/日本語 #100%.pdf';
		expect(resolvePdfFile(app, path).path).toBe(`file:${path}`);
		expect(vault.getFileByPath).toHaveBeenCalledWith(`file:${path}`);
	});
	it('uses vault-relative files when the PDF belongs to the vault', () => {
		const { app, vault } = workspace();
		vault.adapter = { getBasePath: () => '/vault' };
		expect(resolvePdfFile(app, '/vault/books/book.pdf').path).toBe('books/book.pdf');
		expect(vault.getFileByPath).toHaveBeenCalledExactlyOnceWith('books/book.pdf');
	});
	it('does not treat sibling folders as vault files', () => {
		const { app, vault } = workspace();
		vault.adapter = { getBasePath: () => '/vault' };
		expect(resolvePdfFile(app, '/vault-books/book.pdf').path).toBe(
			'file:/vault-books/book.pdf',
		);
	});
	it('reports unsupported native external-file loading without creating a tab', async () => {
		const path = await makePDF();
		const { app, vault, workspace: ws } = workspace();
		vault.getFileByPath.mockReturnValue(null);
		expect(() => resolvePdfFile(app, path)).toThrow(NativePdfUnavailableError);
		await openBook(app, { filepath: path, title: 'Book' });
		expect(ws.getLeaf).not.toHaveBeenCalled();
		expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Update Obsidian'));
	});
	it('migrates an old reader tab in place and restores its page', async () => {
		const { app, workspace: ws, leaf } = workspace();
		leaf.getViewState = () => ({ state: { file: '/books/book.pdf', page: 12 } });
		ws.getLeavesOfType.mockReturnValue([leaf]);
		await migratePdfTabs(app, () => false);
		expect(ws.getLeavesOfType).toHaveBeenCalledWith('desktop-shelf-pdf');
		expect(leaf.openFile).toHaveBeenCalledWith(
			{ path: 'file:/books/book.pdf', extension: 'pdf' },
			{ active: false, eState: { subpath: '#page=12' } },
		);
	});
	it('keeps failed migrations recoverable and stops after plugin unload', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { app, workspace: ws, leaf, vault } = workspace();
		leaf.getViewState = () => ({ state: { file: '/books/missing.pdf' } });
		vault.getFileByPath.mockReturnValue(null);
		ws.getLeavesOfType.mockReturnValue([leaf]);
		await migratePdfTabs(app, () => false);
		expect(Notice).toHaveBeenCalledOnce();
		expect(leaf.openFile).not.toHaveBeenCalled();
		vault.getFileByPath.mockClear();
		await migratePdfTabs(app, () => true);
		expect(vault.getFileByPath).not.toHaveBeenCalled();
	});
});
