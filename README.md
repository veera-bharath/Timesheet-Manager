# Timesheet Manager

A premium Electron desktop app for tracking weekly billable hours across **Jira** and **Service Desk** tickets — with AI-powered assistance for logging, querying, and summarising your work.

## Features

### Core
- **Smart Grouping** — Automatically aggregates entries by Ticket ID or Description into Roman numeral sub-entries for clean, structured reporting
- **Quick Entry** — Inline add-subtask and add-to-group buttons to rapidly duplicate metadata for new time logs
- **Drag & Drop** — Reorder entries within a day with a custom pointer-event drag handle
- **Recurring & Scheduled Tasks** — Define tasks that auto-populate on set days or intervals
- **TXT Export** — Generates perfectly formatted text reports ready for submission or copy-pasting
- **Search** — Inline and advanced search across all entries and weeks
- **Starred Entries** — Pin frequently used entries for quick re-logging
- **Dark / Light Mode** — Premium glassmorphism dashboard interface with full theme support
- **Auto-update** — Built-in updater via electron-updater

### AI (v3.0.0+)
- **Natural Language Entry** — Type "3h on TM-123 fixing login bug" and have it parsed into structured fields automatically
- **Smart Suggestions** — AI autocomplete for ticket, description, and time estimate as you type in the entry modal
- **AI Chat Sidebar** — Ask plain-English questions about your log history: "How much am I missing this week?", "What did I work on Monday?" (Ctrl+Shift+A)
- **Week Summary Generator** — One-click AI narrative of your weekly activity in Bullet, Paragraph, or Standup format — ready for status emails and standups
- **Provider Choice** — Works with local models via Ollama or cloud providers (Claude, OpenAI, Gemini)

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/veera-bharath/Timesheet-Manager.git
   cd Timesheet-Manager
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

## Usage

```bash
npm start        # Run in Electron (development)
npm run pack     # Package without installer
npm run dist     # Build Windows NSIS installer → dist/
```

## License

This project is licensed under the ISC License.
