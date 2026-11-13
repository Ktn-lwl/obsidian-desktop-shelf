// Only the desktop shell APIs this plugin uses; Electron is provided by Obsidian.
declare module 'electron' {
	export const shell: {
		showItemInFolder: (path: string) => void;
	};
}
