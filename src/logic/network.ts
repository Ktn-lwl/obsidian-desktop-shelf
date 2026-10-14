import MyPlugin from '../main';
import { ISBN10, ISBN13 } from '../model/isbn';
import { BookMetadata } from '../model/metadata';

export class EgressClient {
	private readonly plugin: MyPlugin;

	constructor(plugin: MyPlugin) {
		this.plugin = plugin;
	}

	async downloadImage(isbn: ISBN10 | ISBN13): Promise<string | undefined> {
		//download image from Google books API/OpenLibrary into this.plugin.imagesDir
		//save keyed on ISBN used to fetch.
		throw new Error(`Cover image lookup is not implemented for ISBN ${isbn}`);
	}

	async fetchMetadata(isbn: ISBN10 | ISBN13): Promise<BookMetadata | undefined> {
		//fetch book metadata from network source
		throw new Error(`Metadata lookup is not implemented for ISBN ${isbn}`);
	}
}
