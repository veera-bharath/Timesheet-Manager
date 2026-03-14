# Timesheet Manager

A lightweight, efficient Electron application designed for tracking weekly billable hours across **Jira** and **Service Desk** tickets. 

## Features

- **Smart Grouping:** Automatically aggregates entries by Ticket ID or Description into Roman numeral sub-entries for clean reporting.
- **Quick Entry:** Inline "Add Sub-task" and "Add Ticket to Group" buttons to rapidly duplicate metadata for new time logs.
- **TXT Export:** Generates perfectly formatted text reports ready for submission or copy-pasting.
- **Dark Mode:** A sleek, premium dashboard-style interface with glassmorphism effects.
- **Local Storage:** Automatically persists your recent entries and weekly summary.

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

To start the application in development mode:
```bash
npm start
```

## Build

To package the application for distribution:
```bash
npm run dist
```

## License

This project is licensed under the ISC License.
