import { describe, it, expect } from 'vitest';
import { assertISBN10, assertISBN13 } from '../../src/model/isbn';

describe('is_isbn', () => {
	describe('ISBN-10', () => {
		it('accepts a valid ISBN-10', () => {
			// 0-306-40615-2, the standard worked example of the ISBN-10 checksum
			expect(() => assertISBN10('0306406152')).not.toThrow();
		});

		it('accepts a valid ISBN-10 whose check digit is X', () => {
			expect(() => assertISBN10('123456789X')).not.toThrow();
		});

		it("accepts a lowercase 'x' check digit", () => {
			expect(() => assertISBN10('123456789x')).not.toThrow();
		});

		it('rejects an ISBN-10 with an incorrect check digit', () => {
			expect(() => assertISBN10('0306406153')).toThrow();
		});

		it("rejects an ISBN-10 with 'X' outside the check-digit position", () => {
			expect(() => assertISBN10('X23456789X')).toThrow();
		});
	});

	describe('ISBN-13', () => {
		it('accepts a valid ISBN-13', () => {
			// ISBN-13 equivalent of the ISBN-10 example above
			expect(() => assertISBN13('9780306406157')).not.toThrow();
		});

		it('rejects an ISBN-13 with an incorrect check digit', () => {
			expect(() => assertISBN13('9780306406158')).toThrow();
		});
	});

	describe('malformed input', () => {
		it('rejects an empty string', () => {
			expect(() => assertISBN10('')).toThrow();
			expect(() => assertISBN13('')).toThrow();
		});

		it('rejects strings that are neither 10 nor 13 characters', () => {
			expect(() => assertISBN10('123456789')).toThrow(); // 9 chars
			expect(() => assertISBN13('123456789')).toThrow();
			expect(() => assertISBN10('12345678901234')).toThrow(); // 14 chars
			expect(() => assertISBN13('12345678901234')).toThrow();
		});

		it('rejects a hyphenated ISBN even when the digits are valid', () => {
			// real-world ISBNs are almost always printed/typed with hyphens —
			// whatever calls is_isbn needs to strip them first, it won't do it here
			expect(() => assertISBN13('978-0-306-40615-7')).toThrow();
		});

		it('rejects non-digit characters in a 10-length string', () => {
			expect(() => assertISBN10('abcdefghij')).toThrow();
		});

		it('rejects non-digit characters in a 13-length string', () => {
			expect(() => assertISBN13('abcdefghijklm')).toThrow();
		});
	});
});
