import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPDFPaths } from '../../../src/logic/books/directory-crawler';

describe('getPDFPaths', () => {
	it('propagates errors when a directory cannot be opened', async () => {
		const missingDirectory = join(tmpdir(), `missing-${randomUUID()}`);

		await expect(getPDFPaths(missingDirectory).next()).rejects.toMatchObject({
			code: 'ENOENT',
		});
	});
});
