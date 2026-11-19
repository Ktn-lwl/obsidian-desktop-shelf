import { isAbsolute, parse, sep } from 'node:path';

export function isAbsoluteFolderPath(path: unknown): boolean {
	if (typeof path !== 'string' || !isAbsolute(path)) return false;
	// On Windows a single leading slash still depends on the process's current drive.
	return sep !== '\\' || parse(path).root.length > 1;
}
