type ISBN10 = string & { __brand: 'ISBN10' };
type ISBN13 = string & { __brand: 'ISBN13' };
type ISBNData = { ISBN10: ISBN10 | null; ISBN13: ISBN13 | null };

function isISBN10(value: unknown): value is ISBN10 {
	if (typeof value !== 'string' || !/^\d{9}[\dX]$/i.test(value)) return false;
	let sum = value[9]!.toUpperCase() === 'X' ? 10 : Number(value[9]);
	for (let i = 0; i < 9; i++) {
		sum += Number(value[i]) * (10 - i);
	}
	return sum % 11 === 0;
}

function isISBN13(value: unknown): value is ISBN13 {
	if (typeof value !== 'string' || !/^97[89]\d{10}$/.test(value)) return false;
	let sum = 0;
	for (let i = 0; i < value.length; i++) {
		sum += Number(value[i]) * (i % 2 === 0 ? 1 : 3);
	}
	return sum % 10 === 0;
}

export function assertISBN10(value: string): asserts value is ISBN10 {
	if (!isISBN10(value)) throw new Error(`${value} is not a valid ISBN`);
}

export function assertISBN13(value: string): asserts value is ISBN13 {
	if (!isISBN13(value)) throw new Error(`${value} is not a valid ISBN`);
}

export function assertISBN(value: unknown): asserts value is ISBN10 | ISBN13 {
	if (!isISBN10(value) && !isISBN13(value)) throw new Error('Invalid ISBN.');
}

export function normalizeISBN10(value: unknown): ISBN10 | undefined {
	const isbn = typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : undefined;
	return isISBN10(isbn) ? isbn : undefined;
}

export function normalizeISBN13(value: unknown): ISBN13 | undefined {
	const isbn = typeof value === 'string' ? value.replace(/[\s-]/g, '') : undefined;
	return isISBN13(isbn) ? isbn : undefined;
}

export type { ISBN10, ISBN13, ISBNData };
