# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Run app in Electron (development)
npm run pack       # Package app without installer
npm run dist       # Build Windows NSIS installer (outputs to dist/)
```

Uses **electron-vite** as the build tool. Vite bundles the renderer ES modules into a single JS file and merges all CSS `@import`s into a single stylesheet.

## Architecture

**Electron desktop app** — vanilla JS frontend, no framework, no TypeScript.

```
src/
  main/index.js       — Electron main process. BrowserWindow, IPC handlers (ipcMain.handle),
                        electron-store persistence, auto-updater.
  preload/index.js    — Context bridge. Exposes window.electronStore and window.updater
                        via ipcRenderer.invoke.
  renderer/
    index.html        — Single page UI. Bootstrap 5.3.3 via CDN. All modals inline.
    main.js           — Entry point. Imports and initialises all modules.
    modules/          — 18 ES modules (see below).
    styles/
      main.css        — @import aggregator only.
      variables.css   — CSS custom properties (:root + [data-theme="light"]).
      base.css        — Reset, body, animated background.
      header.css      — App header.
      buttons.css     — Button variants + ripple effect.
      cards.css       — Glass card, form inputs, day cards, holiday toggle.
      entries.css     — Entry rows, drag handle, add-entry btn, entry buttons, scheduled badge.
      layout.css      — Totals bar / week progress chips.
      modals.css      — Modal chrome + TXT preview.
      utilities.css   — Print styles, scrollbar, utility classes, toast.
      sidebar.css     — Offcanvas sidebar + about modal.
      copy-to.css     — Copy-to-day picker buttons.
      recurring.css   — Recurring task UI.
      context-menu.css — Right-click menu, quick-view popover, cheatsheet, kbd.
      entry-detail.css — Entry day total indicator.
      search.css      — Search bar, dropdown, advanced search.
      animations.css  — All keyframe animations and motion preferences.
```

## Renderer Modules (`src/renderer/modules/`)

| Module | Responsibility |
|---|---|
| `state.js` | Shared `state` object + constants (APP_VERSION, WEEK_DAYS, ROMAN, etc.) |
| `utils.js` | Pure utilities: escHtml, fmtDate, minsToHHMM, padTicket, animateCountUp, etc. |
| `store.js` | Async `saveState` / `loadState` via `window.electronStore` |
| `toast.js` | `showToast`, `showConfirm` |
| `theme.js` | `initTheme`, `applyTheme` |
| `ripple.js` | `initRipple` |
| `week.js` | ISO week helpers, `buildWeekDays`, `enforceExpandedState`, `changeWeekBy` |
| `summary.js` | `calcDayTotalMins`, `updateSummary` |
| `render.js` | `renderAll`, `buildGroups`, `buildDayCard`, `toggleDay`, drag-and-drop |
| `entry-modal.js` | Entry CRUD, undo, `openEntryModal`, `saveEntry`, `deleteEntry` |
| `copy-to.js` | Copy-to-week modal |
| `recurring.js` | Recurring task management |
| `scheduled.js` | Scheduled task management |
| `context-menu.js` | Right-click menu + quick-view popover (co-located for shared Escape handler) |
| `report.js` | TXT generation, preview, copy, download, print |
| `search.js` | Inline + advanced search, `navigateToResult` |
| `star.js` | Starred entries, starred list modal |
| `sidebar.js` | Sidebar/about, auto-updater listeners, keyboard shortcuts |

## IPC Pattern

Main process uses `ipcMain.handle` (async); renderer uses `ipcRenderer.invoke` (returns a Promise). `saveState` and `loadState` are both `async`.

## State & Persistence

All data stored via **electron-store** (not localStorage). The central `state` object holds the current week's data and is serialised on every change.

**Day model:** `{ date, isHoliday, holidayLabel, expanded, entries[] }`
**Entry model:** `{ ticket, hh, mm, type, desc, isScheduled?, starred?, groupId?, groupType? }`

`groupType` is one of `"normal"`, `"ticket_group"`, or `"desc_group"`. Grouping is computed in `buildGroups()` and rendered with Roman numeral sub-numbering.

## Key Patterns

- **Week handling:** ISO week logic, Monday–Friday only. Week picker auto-fills to current week.
- **Drag-and-drop:** Custom pointer-event implementation (not the HTML5 drag API).
- **Accordion state:** Day expand/collapse state is persisted per-week via electron-store.
- **Rendering:** All day/entry HTML is generated dynamically; there is no templating engine.
- **Circular imports:** Several modules import each other (render ↔ entry-modal, etc.). Safe because cross-module calls only happen inside event handlers, never at module evaluation time.

## Git Workflow

Follows Gitflow. Feature branches use the pattern `feature/tm-<ticket-number>-<description>`. PRs merge into `develop`; releases merge into `main` and are tagged (e.g., `v1.4.0`).
