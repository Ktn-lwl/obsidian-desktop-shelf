# Obsidian Desktop Library

## Problem

I have a lot of e-textbooks. Whenever I want to learn a new topic, I usually get an e-textbook on it and store it in an Obsidian vault so I can study and take notes on it at the same time. This causes two problems: vaults get crowded with textbooks unrelated to their actual purpose, or I end up copying textbooks between vault folders, wasting storage, since vaults in Obsidian are self-contained folders.

## Proposed Solution

A library plugin that syncs textbooks from anywhere on the local filesystem and renders a bookshelf view inside Obsidian, without copying files into a vault.

## Technical Overview

- Obsidian Plugin API
- TypeScript
- `pdf-parse` — extracts text from PDFs for regex scanning
- OpenLibrary JSON API — metadata lookup by ISBN

> [!Tip] Metadata lookup source
> OpenLibrary is simpler to implement in theory becuase their REST api is unauthenticated. The gooogle books api however requires either OAuth 2.0 or an API key for access. Tradeoff here is data quality + aesthetics over simplicity.

Since scanning arbitrary filesystem locations (and later, the shared catalog) both require raw Node filesystem access, this plugin is desktop-only by design. Set `isDesktopOnly: true` in the plugin manifest.

### Library Configuration + Population

The user provides one or more top-level directories for the plugin to scan for PDFs. These directories are saved in the plugin's settings so future scans don't require re-prompting. On each scan (manual or periodic), the plugin walks those directories, collects PDF paths, and passes them to the parser.

### Library Parsing

Each found PDF has its first 5–10 pages (not the whole document) extracted with `pdf-parse` and scanned with a regex for ISBNs. Scoping to the first few pages keeps large textbooks fast to scan and avoids false positives from ISBNs that show up later in the book (bibliographies, "also available as," other-edition callouts). When both an ISBN-10 and ISBN-13 are found, prefer the ISBN-13; otherwise take the first valid match.

Identified ISBNs get their metadata pulled from the OpenLibrary API and cached locally for rendering. Books that can't be identified fall back to their filename and a rendered first page as a placeholder cover.

For unidentified PDFs, show the user the list so they can either manually supply an ISBN or mark the file as "not a book" to exclude it from future scans. This keeps a bad regex match from silently mislabeling something forever.

### OpenLibrary API

Metadata is pulled from OpenLibrary's ISBN lookup endpoint, keyed by the ISBNs found during parsing. At minimum this should include: title, author(s), a cover image URL, and the numeric cover ID — the fields the library view actually needs to render a shelf. Anything else OpenLibrary returns (subjects, publish date, page count) can be stored for a future detail view but isn't required for v1.

All requests should include a `User-Agent` header identifying the plugin and a contact email. Unidentified requests to OpenLibrary's main API are limited to 1 request/second; identified ones get 3/second. On a first sync of a large library, these metadata lookups will hit that per-second limit well before the covers limit below does, so the same "batch the initial sync" approach applies here too.

> [!Warning] Courtesy and rate limiting
> Open Library explicitly forbids bulk crawling of their API for book covers, and rate-limits cover access **by ISBN or other identifiers** to 100 requests per 5 minutes — accessing a cover by its numeric cover ID isn't rate-limited at all. Since the cover ID gets cached alongside the rest of a book's metadata on first lookup, this only matters for the initial sync: once cached, every later access (re-renders, reopening the library) goes through the ID-based endpoint and skips the limit entirely. For a first sync of an existing library with over a hundred books, batch the initial ISBN-based cover requests to 75 every 5 minutes.

### Persistence

Since the catalog needs to be visible from every vault, and Obsidian vaults are isolated from each other by design (each has its own `.obsidian` directory for settings, config, and plugins), the plugin needs a way around that isolation with as small a footprint as possible.

Rather than storing the catalog inside Obsidian's own app-level config folder (`%APPDATA%\obsidian` on Windows, etc.) — which is undocumented, internal Obsidian bookkeeping, not meant for plugin data — the catalog lives in a folder the plugin owns itself (default: something like `~/.obsidian-book-library/catalog.json`, configurable in settings). Each vault installs and enables the plugin the normal way (a one-time step, same as any other plugin); what's shared is just the data file each instance points at, not the plugin's enabled/disabled state.

On activation, the plugin looks for the catalog file at the configured path — uses it if found, creates it if missing — then periodically rescans and updates it.

Writes use an atomic pattern (write to a temp file, then rename over the target) plus a version/timestamp field inside the JSON itself, so a vault only overwrites its local view when the file on disk is newer. This avoids the corruption and lost-update problems a lock file solves, without needing real cross-platform file locking, which is unreliable in Node and unnecessary at this contention level (single user, infrequent writes).

## Projected Issues

| Issue                 | Description                                                                                                                                                          | Fix                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vault isolation       | The catalog needs to be shared among vaults, but Obsidian vaults are isolated by design — each has its own `.obsidian` directory for settings, configs, and plugins. | Store the catalog in a plugin-owned folder outside any vault and outside Obsidian's own app config, at a path each vault's plugin instance points to via its own settings. |
| Vault race conditions | Multiple vaults could try to write the shared catalog at the same time.                                                                                              | Atomic write (temp file + rename) plus an embedded version/timestamp field, so a stale write never overwrites a newer one. No separate lock file needed.                   |
| Mobile compatibility  | Both the directory scan and the shared catalog require raw Node filesystem access, which doesn't exist on Obsidian mobile.                                           | Mark the plugin `isDesktopOnly: true` in the manifest; no mobile support planned.                                                                                          |
| ISBN false positives  | Scanning an entire PDF for ISBNs can pick up unrelated ISBNs later in the document (bibliographies, other editions).                                                 | Scope the regex scan to the first 5–10 pages per file; prefer ISBN-13 over ISBN-10 when both appear; take the first valid match.                                           |
| CORS bypass           | It can be a hassle getting electron apps to work with REST calls due to the Cross Origin Resource Sharing policy                                                     |                                                                                                                                                                            |

## Stretch Goals

- Customizable book covers, titles, and authors (manual overrides on top of OpenLibrary data)
- Per-vault reading lists ("playlists") built from the shared catalog

## Timeline

1. Directory scanning + PDF discovery
2. ISBN regex extraction + OpenLibrary metadata lookup
3. Library view UI (render the bookshelf inside Obsidian)
4. Shared cross-vault catalog + persistence
5. Stretch goals (custom metadata, per-vault reading lists)
