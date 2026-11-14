# Obsidian Desktop Library

## Problem

I have a lot of e-textbooks. Whenever I want to learn a new topic, I usually get an e-textbook on it and store it in an Obsidian vault so I can study and take notes on it at the same time. This causes two problems: vaults get crowded with textbooks unrelated to their actual purpose, or I end up copying textbooks between vault folders, wasting storage, since vaults in Obsidian are self-contained folders.

## Proposed Solution

A library plugin that syncs textbooks from anywhere on the local filesystem and renders a bookshelf view inside Obsidian, without copying files into a vault.

## Using My Library

1. Select the library ribbon icon or run **Open My Library** from the command palette.
2. Open **Settings → Desktop Shelf → Watched folders → Add folder** and enter a local folder containing PDFs. The library scans its subfolders without copying PDFs into your vault.
3. Search by title, author, ISBN, or filename, and sort by title or author.
4. Select a book to open its PDF in an Obsidian tab. Select **Book details** to see metadata and use **Show in folder**.
5. Select **Refresh** to scan again. The shelf shows progress and reports folders or books that could not be processed.

Books open in Obsidian’s built-in PDF viewer, with its native toolbar, search, text selection, navigation, and zoom. External PDFs stay in their original folders; no PDF copies or reference files are created in the vault. Obsidian manages PDF tabs and their workspace state. Existing tabs from the earlier custom reader migrate when the plugin loads.

Requires desktop Obsidian 1.14.2 or newer for native external-file support. The adapter uses Obsidian’s internal `file:` path convention through the public file-opening APIs; unsupported builds show an error instead of opening another app. External paths remain local to the computer, so another device needs access to the same paths.

Each ISBN appears once in the library, even when copies exist in multiple folders. Equivalent ISBN-10 and ISBN-13 values share an entry; different edition ISBNs remain separate. **Book details** lists every copy, and opening a book falls back to another available location. Existing catalogs migrate automatically on save, retaining their file locations.

The library opens in a workspace tab and reuses that tab when opened again. Cached books remain available during refresh. Covers load from the local cache as you scroll. When no downloaded cover is available, the first PDF page becomes the cover. These previews are generated locally only when needed, cached, and refreshed when the PDF changes. Unreadable PDFs retain the book title placeholder.

Online lookup is optional and disabled by default; enable it in the plugin settings to fetch metadata and covers. Only PDFs with a valid detected ISBN enter the library automatically. Other PDFs stay outside the library until you explicitly include them or assign an ISBN.

## Manual library edits

- Open **Add books** to review PDFs without a detected ISBN and search by title or file path. Select **Include** to add one without an ISBN, or **Assign ISBN** to enter an ISBN-10 or ISBN-13. If the ISBN already exists, the dialog previews the merge before you save. Every file location is retained.
- Use **Book details → Edit details** to change the title, author, publisher, or publication year. Changes apply to the shared ISBN entry, survive online refreshes, and are shared across vaults using the same catalog. **Reset** reverts a field to scanned or online details when you save.
- Each file location has **Correct ISBN**. A correction affects that copy only; other copies retain their current ISBN. Online lookup runs after identification only when enabled in settings.
- For books explicitly included without an identifier, **Book details → Remove from library** revokes that inclusion and returns the file to **Add books**. The PDF stays on disk.

Scans cache unidentified results separately from library entries and use file size and modification time to avoid repeating ISBN extraction for unchanged PDFs. Cached PDFs awaiting inclusion do not appear on the shelf or count as library books. Directory traversal still runs to discover new PDFs. Manually assigned ISBNs remain authoritative when a file changes; automatic identifications are rescanned when the file changes. Existing catalog entries acquire a file fingerprint on their next scan without repeating extraction.

Manual changes are saved under the catalog lock against the latest on-disk state. Each save patches only the changed fields, preserving other vaults’ edits; the most recent save wins when two vaults edit the same field. Explicit inclusions and ISBN assignments are stored separately from scan results so stale refreshes cannot undo them. Existing unidentified records from earlier catalogs move to the pending list unless explicitly included.

## Technical Overview

- Obsidian Plugin API
- TypeScript
- Obsidian's PDF.js loader — extracts text from PDFs for ISBN scanning
- Open Library — metadata lookup by ISBN
- Google Books content endpoint — cover lookup by ISBN

Since scanning arbitrary filesystem locations (and later, the shared catalog) both require raw Node filesystem access, this plugin is desktop-only by design. Set `isDesktopOnly: true` in the plugin manifest.

### Library Configuration + Population

The user provides one or more top-level directories for the plugin to scan for PDFs. These directories are saved in the plugin's settings so future scans don't require re-prompting. On each scan (manual or periodic), the plugin walks those directories, collects PDF paths, and passes them to the parser.

### Library Parsing

Each found PDF is scanned page-by-page through the first and last 10% of its pages using Obsidian's PDF.js loader. Scanning stops early as soon as a valid ISBN-13 is found, which avoids reading all of those pages for most books while still catching identifiers in the front matter or back matter. When a page labels a list of ISBNs (such as hardback, PDF, and EPUB editions), each listed identifier is validated and the first valid ISBN-13 is selected. This limits false positives from ISBNs elsewhere in the book (bibliographies, "also available as," other-edition callouts). When no ISBN-13 is found, the first valid ISBN-10 is retained.

Identified ISBNs get their metadata pulled from Open Library and cached locally for rendering. Covers are fetched separately from the Google Books content endpoint and downloaded locally when available; missing covers do not prevent metadata from being saved.

Unidentified PDFs remain outside the library in **Add books**, where users can supply an ISBN or explicitly include a file. This keeps a bad regex match from silently mislabeling something forever.

### Book metadata and covers

Metadata requests use Open Library's ISBN search endpoint. Transient request failures are retried with backoff, and valid responses without a matching book are marked missing. Cover requests use the Google Books content endpoint with the ISBN and are cached locally; metadata lookup does not depend on Google Books API availability.

Online lookup is disabled by default. Enable **Online book lookup** in the plugin settings, then run **Refresh Library** to fetch metadata and covers. With this setting enabled, the plugin sends ISBNs to Open Library for metadata and Google Books for cover images. Neither service receives PDF contents or local file paths.

### Persistence

Since the catalog needs to be visible from every vault, and Obsidian vaults are isolated from each other by design (each has its own `.obsidian` directory for settings, config, and plugins), the plugin needs a way around that isolation with as small a footprint as possible.

Rather than storing the catalog inside Obsidian's own app-level config folder (`%APPDATA%\obsidian` on Windows, etc.) — which is undocumented, internal Obsidian bookkeeping, not meant for plugin data — the catalog lives in a folder the plugin owns itself (default: something like `~/.obsidian-book-library/catalog.json`, configurable in settings). Each vault installs and enables the plugin the normal way (a one-time step, same as any other plugin); what's shared is just the data file each instance points at, not the plugin's enabled/disabled state.

On activation, the plugin looks for the catalog file at the configured path — uses it if found, creates it if missing — then periodically rescans and updates it.

Writes acquire an exclusive lock file, reread the latest catalog while holding the lock, merge the current vault's scan results, then write a unique temporary file and rename it over the catalog. A successfully scanned watched folder is authoritative for which paths remain in that folder; for duplicate paths, the record with the latest metadata-update attempt is retained. Entries outside the current vault's scanned folders and entries under folders that failed to scan are retained; newer metadata updates are merged regardless of scan success. If a process crashes while holding the lock, later writers time out with instructions to remove the stale lock only after confirming no plugin instance is using the catalog.

## Projected Issues

| Issue                 | Description                                                                                                                                                          | Fix                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vault isolation       | The catalog needs to be shared among vaults, but Obsidian vaults are isolated by design — each has its own `.obsidian` directory for settings, configs, and plugins. | Store the catalog in a plugin-owned folder outside any vault and outside Obsidian's own app config, at a path each vault's plugin instance points to via its own settings. |
| Vault race conditions | Multiple vaults could try to write the shared catalog at the same time.                                                                                              | Serialize writes with an exclusive lock, reread and merge the latest catalog, and atomically replace the file.                                                             |
| Mobile compatibility  | Both the directory scan and the shared catalog require raw Node filesystem access, which doesn't exist on Obsidian mobile.                                           | Mark the plugin `isDesktopOnly: true` in the manifest; no mobile support planned.                                                                                          |
| ISBN false positives  | Scanning an entire PDF for ISBNs can pick up unrelated ISBNs later in the document (bibliographies, other editions).                                                 | Scope the scan to the first and last 10% of pages and stop early when an ISBN-13 is found; prefer ISBN-13 over ISBN-10 when both appear; take the first valid match.       |
| CORS bypass           | It can be a hassle getting electron apps to work with REST calls due to the Cross Origin Resource Sharing policy                                                     | Use Obsidian's `requestUrl` API for network requests.                                                                                                                      |

Open Library metadata requests are serialized and spaced one second apart. Transient retries pass through the same queue, honor `Retry-After` up to five minutes, and identify the plugin with a `User-Agent` containing its version and project URL.

## Stretch Goals

- Customizable book covers
- Per-vault reading lists ("playlists") built from the shared catalog

## Timeline

1. Directory scanning + PDF discovery
2. ISBN regex extraction + Open Library metadata and Google Books cover lookup
3. Library view UI (render the bookshelf inside Obsidian)
4. Shared cross-vault catalog + persistence
5. Stretch goals (custom metadata, per-vault reading lists)
