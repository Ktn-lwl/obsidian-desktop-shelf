import { assertISBN10, assertISBN13, ISBNData } from '../../model/isbn';
import { loadPdfJs } from 'obsidian';
import { readFile } from 'node:fs/promises';
import { throwIfAborted } from '../../utils/cancellation';

const ISBN_MARKER_REGEX = /\bISBN(?:[\s-]*(10|13))?s?\b[ \t]*[:：#=]?[ \t]*/gi;
const FORMATTING_SEPARATOR = '[\\s\\-\\u2010-\\u2015\\u2212]';
const ISBN_CANDIDATES_REGEX = new RegExp(
	`(?:^|[^0-9A-Z])((?:[0-9X](?:${FORMATTING_SEPARATOR}*[0-9X]){12})|(?:[0-9X](?:${FORMATTING_SEPARATOR}*[0-9X]){9}))(?!${FORMATTING_SEPARATOR}*[0-9X])`,
	'i',
);
const ISBN_CANDIDATE_GLOBAL_REGEX = new RegExp(ISBN_CANDIDATES_REGEX.source, 'gi');
const PAGE_SCAN_RATIO = 0.1;

interface PdfPage {
	getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
	cleanup: () => void;
}

interface PdfDocument {
	numPages: number;
	getPage: (page: number) => Promise<PdfPage>;
	destroy: () => Promise<void>;
}

interface PdfJsApi {
	getDocument: (options: { data: Uint8Array }) => { promise: Promise<PdfDocument> };
}

async function discoverISBNs(filePath: string, signal?: AbortSignal) {
	console.log(`Discovering ISBNs for file at: ${filePath}`);
	const isbnData: ISBNData = { ISBN10: null, ISBN13: null };
	let scannedPageCount = 0;

	try {
		for await (const pageText of extractPdfPages(filePath, true, signal)) {
			const pageISBNs = extractISBNs(pageText);
			scannedPageCount++;
			isbnData.ISBN10 ??= pageISBNs.ISBN10;
			isbnData.ISBN13 ??= pageISBNs.ISBN13;

			if (isbnData.ISBN13) break;
		}
	} catch (err) {
		throwIfAborted(signal);
		const message = err instanceof Error ? err.message : String(err);
		console.error(`Failed to extract text from ${filePath}: ${message}`);
	}

	console.info(`Scanned ${scannedPageCount} pages for ISBNs.`);
	if (isbnData.ISBN10 || isbnData.ISBN13) {
		console.log(`Successfully extracted ISBNs for file at ${filePath}`);
	} else {
		console.log(`Failed to extract ISBNs for file at ${filePath}`);
	}

	return isbnData;
}

function extractISBNs(text: string): ISBNData {
	const isbnData: ISBNData = { ISBN10: null, ISBN13: null };

	for (const marker of text.matchAll(ISBN_MARKER_REGEX)) {
		const start = marker.index + marker[0].length;
		const nextLineBreak = text.indexOf('\n', start);
		const nextMarker = text.slice(start).match(ISBN_MARKER_REGEX)?.index;
		const end = Math.min(
			nextLineBreak === -1 ? text.length : nextLineBreak,
			nextMarker === undefined ? text.length : start + nextMarker,
		);
		const identifiers = text.slice(start, end);

		for (const candidate of identifiers.matchAll(ISBN_CANDIDATE_GLOBAL_REGEX)) {
			const rawCandidate = candidate[1];
			if (!rawCandidate) continue;

			const isbn = rawCandidate.replace(/[\s\-\u2010-\u2015\u2212]/g, '').toUpperCase();
			const expectedLength = marker[1] === '10' ? 10 : marker[1] === '13' ? 13 : undefined;
			if (expectedLength !== undefined && isbn.length !== expectedLength) continue;

			try {
				if (isbn.length === 13 && isbnData.ISBN13 === null) {
					assertISBN13(isbn);
					isbnData.ISBN13 = isbn;
				} else if (isbn.length === 10 && isbnData.ISBN10 === null) {
					assertISBN10(isbn);
					isbnData.ISBN10 = isbn;
				}
			} catch {
				continue;
			}
		}
	}

	return isbnData;
}

async function extractText(filePath: string): Promise<string | null> {
	try {
		const pages: string[] = [];
		for await (const pageText of extractPdfPages(filePath)) {
			pages.push(pageText);
		}
		return pages.join('\n\n');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`Failed to extract text from ${filePath}: ${message}`);
		return null;
	}
}

async function* extractPdfPages(
	filePath: string,
	includeLastPages = false,
	signal?: AbortSignal,
): AsyncGenerator<string> {
	let doc: PdfDocument | undefined;

	try {
		throwIfAborted(signal);
		const pdfjs = (await loadPdfJs()) as PdfJsApi;
		throwIfAborted(signal);
		const buf = await readFile(filePath, { signal });
		throwIfAborted(signal);
		const data = new Uint8Array(buf);
		const loadedDoc: PdfDocument = await pdfjs.getDocument({ data }).promise;
		doc = loadedDoc;

		const scanCount = Math.ceil(loadedDoc.numPages * PAGE_SCAN_RATIO);
		const pagesToScan = new Set<number>();
		for (let pageNumber = 1; pageNumber <= scanCount; pageNumber++) {
			pagesToScan.add(pageNumber);
		}
		if (includeLastPages) {
			for (
				let pageNumber = Math.max(scanCount + 1, loadedDoc.numPages - scanCount + 1);
				pageNumber <= loadedDoc.numPages;
				pageNumber++
			) {
				pagesToScan.add(pageNumber);
			}
		}

		for (const pageNumber of pagesToScan) {
			throwIfAborted(signal);
			const page = await loadedDoc.getPage(pageNumber);
			try {
				throwIfAborted(signal);
				const content = await page.getTextContent();
				throwIfAborted(signal);
				yield content.items.map((item: { str?: string }) => item.str ?? '').join(' ');
			} finally {
				page.cleanup();
			}
		}
	} finally {
		await doc?.destroy();
	}
}
export { discoverISBNs, extractISBNs, extractText };
