import { mkdir, open, writeFile, readFile, rename, unlink } from 'node:fs/promises';
import type { CatalogFile } from '../model/catalog';
import { delay, throwIfAborted } from '../utils/cancellation';
import { normalizeCatalog } from './manual-state';

const CATALOG_LOCK_TIMEOUT_MS = 15_000;
const CATALOG_LOCK_RETRY_MS = 100;
let temporaryFileCounter = 0;

/** All writers reread and modify the latest catalog while holding the same lock. */
export class CatalogStore {
	constructor(private readonly plugin: { catalogDir: string; catalogPath: string }) {}
	async update(
		change: (catalog: CatalogFile) => void | Promise<void>,
		signal?: AbortSignal,
	): Promise<CatalogFile> {
		throwIfAborted(signal);
		await mkdir(this.plugin.catalogDir, { recursive: true });
		return this.withLock(async () => {
			const catalog = (await this.read()) ?? { lastUpdated: 0, data: {} };
			await change(catalog);
			normalizeCatalog(catalog);
			catalog.lastUpdated = Math.max(Date.now(), catalog.lastUpdated + 1);
			const tmp = `${this.plugin.catalogPath}.${process.pid}.${Date.now()}.${temporaryFileCounter++}.tmp`;
			try {
				throwIfAborted(signal);
				await writeFile(tmp, JSON.stringify(catalog, null, 2), 'utf-8');
				throwIfAborted(signal);
				await rename(tmp, this.plugin.catalogPath);
			} catch (error) {
				await unlink(tmp).catch((cleanupError: NodeJS.ErrnoException) => {
					if (cleanupError.code !== 'ENOENT') throw cleanupError;
				});
				throw error;
			}
			return catalog;
		}, signal);
	}
	async read(): Promise<CatalogFile | undefined> {
		let raw: string;
		try {
			raw = await readFile(this.plugin.catalogPath, 'utf-8');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
			throw error;
		}

		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			typeof (parsed as CatalogFile).lastUpdated !== 'number' ||
			typeof (parsed as CatalogFile).data !== 'object' ||
			(parsed as CatalogFile).data === null ||
			Array.isArray((parsed as CatalogFile).data)
		) {
			throw new Error(`Catalog has an invalid format: ${this.plugin.catalogPath}`);
		}
		const catalog = parsed as CatalogFile;
		normalizeCatalog(catalog);
		return catalog;
	}

	private async withLock<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		const lockPath = `${this.plugin.catalogPath}.lock`;
		const deadline = Date.now() + CATALOG_LOCK_TIMEOUT_MS;
		let lockHandle: Awaited<ReturnType<typeof open>> | undefined;

		while (!lockHandle) {
			throwIfAborted(signal);
			let candidate;
			try {
				candidate = await open(lockPath, 'wx');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
				if (Date.now() >= deadline) {
					throw new Error(
						`Timed out waiting for the catalog lock at ${lockPath}. If no plugin process is using the catalog, remove this stale lock file and retry.`,
					);
				}
				await delay(CATALOG_LOCK_RETRY_MS, signal);
				continue;
			}

			try {
				await candidate.writeFile(
					JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }),
					'utf-8',
				);
				lockHandle = candidate;
			} catch (error) {
				await candidate.close();
				await unlink(lockPath);
				throw error;
			}
		}

		try {
			return await operation();
		} finally {
			try {
				await lockHandle.close();
			} finally {
				await unlink(lockPath);
			}
		}
	}
}
