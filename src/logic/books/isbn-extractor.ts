import { PDFParse } from 'pdf-parse';
import { assertISBN10, assertISBN13, ISBNData } from '../../model/isbn';

const ISBN_10_REGEX = /(?:ISBN-?(?:10)?[:-]?\s+)((\d-?){9}[\dx])/gi;
const ISBN_13_REGEX = /(?:ISBN-?(?:13)?[:-]?\s+)((\d-?){13})/gi;

async function discoverISBNs(filePath: string) {
	console.log(`Discovering ISBNs for file at: ${filePath}`);
	let isbnData: ISBNData = { ISBN10: null, ISBN13: null };

	const docText = (await extractText(filePath))?.text ?? '';

	const isbn10s = Array.from(docText.matchAll(ISBN_10_REGEX), (match) =>
		match[1]!.replaceAll('-', ''),
	);
	const isbn13s = Array.from(docText.matchAll(ISBN_13_REGEX), (match) =>
		match[1]!.replaceAll('-', ''),
	);

	console.info(
		`Found ${isbn10s.length} candidate ISBN-10s and ${isbn13s.length} candidate ISBN-13s.`,
	);

	for (const isbn of isbn10s) {
		try {
			assertISBN10(isbn);
			isbnData.ISBN10 = isbn;
			break;
		} catch {
			continue;
		}
	}
	for (const isbn of isbn13s) {
		try {
			assertISBN13(isbn);
			isbnData.ISBN13 = isbn;
			break;
		} catch {
			continue;
		}
	}

	if (isbnData.ISBN10 || isbnData.ISBN13) {
		console.log(`Successfully extracted ISBNs for file at ${filePath}`);
	} else {
		console.log(`Failed to extract ISBNs for file at ${filePath}`);
	}

	return isbnData;
}

async function extractText(filePath: string) {
	const parser = new PDFParse({ url: filePath, disableAutoFetch: true });
	let docText = null;

	try {
		docText = await parser.getText({ first: 10 });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`Failed to extract text from file at ${filePath}: ${message}`);
	} finally {
		await parser.destroy();
	}

	return docText;
}

export { discoverISBNs, extractText };
