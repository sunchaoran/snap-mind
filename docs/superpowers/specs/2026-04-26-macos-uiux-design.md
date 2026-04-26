# SnapMind macOS UI/UX Design

Date: 2026-04-26

## Purpose

SnapMind for macOS should be a quiet native companion for the existing SnapMind service. It is not a second Obsidian editor and not a heavy operations dashboard. Its job is to make screenshot capture effortless, then make saved clips easy to search, skim, and reopen in Obsidian.

The design follows the product posture chosen during review:

- Menu bar light entry for capture.
- Read-only knowledge browser as the main window.
- Mail-style three-column layout.
- Summary-first detail view.
- Obsidian remains the editing and long-term knowledge workspace.

## Product Principles

1. Capture should feel deliberate and low friction.
   Users add screenshots by dragging files into the menu bar popover or pasting a screenshot with `Cmd+V`. The app should not auto-import screenshots by default.

2. Browsing should be calm and native.
   The main window should use familiar macOS structures: sidebar, searchable list, detail pane, toolbar actions, menus, and keyboard shortcuts.

3. The app is read-only by default.
   Users can search, filter, preview, open in Obsidian, and retry failed processing. They do not edit note body, title, tags, summary, or frontmatter inside the macOS app.

4. Diagnostics should stay out of the default reading path.
   The detail view focuses on human-readable content. Failure status can be visible, but raw VLM output, fetch traces, and model diagnostics belong in a later advanced inspector or debug surface.

## Scene Model

The app should use two primary macOS surfaces.

### Menu Bar Extra

The menu bar extra is the daily entry point. It should be fast to open, small enough to understand at a glance, and optimized for adding one or several screenshots.

Core elements:

- Header with service status: Ready, Processing, Offline, or Needs Setup.
- Drop zone: "Drop screenshots here" with secondary hint "or press Cmd+V".
- Queue list showing recent submissions and status.
- Actions: Open Library, Open Settings, Retry failed item, Open in Obsidian for completed item.

The popover should not become a miniature dashboard. It only needs enough feedback for the user to trust that capture worked.

### Main Window

The main window is a read-only knowledge browser. It opens from the menu bar, Dock, app menu, or keyboard shortcut.

Default layout:

- Left sidebar: saved views and filters.
- Middle list: searchable clip results.
- Right detail pane: summary-first preview.

The main window should restore selection and window size between launches. If there is no selected clip, show an empty state with a concise prompt to drop or paste screenshots from the menu bar.

## Main Window Layout

### Sidebar

The sidebar should use native source-list styling and stay lightweight.

Suggested groups:

- Library: All Clips, Today, This Week, Needs Retry.
- Platforms: Xiaohongshu, Twitter/X, Reddit, Weibo, Zhihu, Weixin, Bilibili, Douban, Hacker News, YouTube, Medium, Substack, Unknown.
- Categories: Tech, Design, Product, Business, Finance, Science, Life, Culture, Career, Other.

Rows should be simple: one icon, one label, optional count. Avoid card-style sidebar rows.

### Result List

The middle column is optimized for scanning.

Each row should show:

- Title.
- Platform and author when available.
- 1-3 tags.
- Created date or relative time.
- Small status indicator for failed or screenshot-only clips.

Search should cover title, author, platform, tags, category, summary, and original URL. Filtering should combine with search.

### Detail Pane

The right pane is summary-first and read-only.

Visible content:

- Title.
- Platform, author, saved date, and source URL status.
- Tags and category.
- 3-5 sentence summary.
- Screenshot preview.
- Actions: Open in Obsidian, Copy Obsidian Link, Copy Original URL when available.

The detail pane should not show full article text by default. Long-form reading and editing happen in Obsidian.

For failed or incomplete clips, show a small inline status area:

- Failed to fetch original.
- Screenshot saved.
- Retry Processing action.

Do not expose raw model JSON in the default view.

## Capture Flow

### Drag And Drop

1. User opens the menu bar popover.
2. User drops one or more image files into the drop zone.
3. The popover immediately shows each item in the queue.
4. Each item progresses through waiting, analyzing, fetching, writing, done, or failed.
5. Done items expose Open in Obsidian.

### Paste

1. User opens the menu bar popover.
2. User presses `Cmd+V`.
3. If the clipboard contains an image, the app queues it.
4. If the clipboard does not contain an image, show a short non-blocking message.

### Failure Handling

Failures should be understandable without logs:

- Service offline: show connection status and Settings action.
- Missing API key or vault path: show setup status and Settings action.
- Processing failed: keep the item visible with Retry and Open Screenshot if available.

## Settings

Settings should be a native macOS Settings scene, not a tab inside the main browser.

Initial settings:

- SnapMind service URL.
- API key or token reference.
- Obsidian vault path.
- Screenshot display width.
- Enable launch at login.
- Optional advanced fields: max fetch level, menu bar queue history size.

Model selection and low-level fetcher tuning can remain outside the first UI pass unless needed for local development.

## Commands And Keyboard

The app should expose core actions through menus and keyboard shortcuts.

Suggested shortcuts:

- `Cmd+N`: Open menu bar capture popover or focus capture action.
- `Cmd+F`: Focus search in main window.
- `Cmd+O`: Open selected clip in Obsidian.
- `Cmd+R`: Retry selected failed clip.
- `Cmd+,`: Open Settings.

Context menus should exist for list rows:

- Open in Obsidian.
- Copy Obsidian Link.
- Copy Original URL.
- Retry Processing when applicable.

## Visual Direction

The app should feel like a native macOS utility:

- Standard sidebar material and selection behavior.
- Restrained color.
- No marketing-style hero surfaces.
- No oversized cards in the sidebar.
- Information-dense but calm list rows.
- Semantic status color only where it helps: green done, amber processing or partial, red failed.

The UI should work well in Light and Dark mode by using system-adaptive colors and materials.

## Integration Boundaries

The macOS app should talk to the existing SnapMind service rather than duplicate the processing pipeline.

Expected service interactions:

- Submit image to `/clip` or `/clip/batch`.
- Poll `/jobs/:id` and `/batch/:id`.
- Read existing saved clips from the Obsidian vault or a local index derived from Markdown frontmatter.
- Open generated Markdown files in Obsidian.
- Retry failed items through the existing service once a retry endpoint or equivalent local action exists.

If the service is not running, the app should make that obvious and provide recovery actions, not silently fail.

## Deferred Ideas

These are intentionally out of scope for the first UI/UX design:

- Full Markdown editing inside the app.
- Automatic screenshot folder watching by default.
- A full operations dashboard with raw VLM traces.
- Cloud sync or DynamoDB browsing.
- Native share extension as the primary capture path.

These can be revisited after the basic menu bar capture and read-only browser feel right.

## Implementation Defaults

These defaults keep the first implementation focused while leaving room for later API improvements:

1. The main window should initially build its library from Obsidian Markdown frontmatter and sidecar JSON files. A service-backed clip index API can replace this later if scanning the vault becomes slow or brittle.
2. Retry should appear only for clips where the backend already exposes a safe retry path. If no retry endpoint exists, the UI should show the failed status and an Open in Obsidian action, but disable Retry with a tooltip.
3. The menu bar queue should show current-session submissions plus a short recent history of the last 10 completed items, enough to confirm recent work without becoming a full activity log.
