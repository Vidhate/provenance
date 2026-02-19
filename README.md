# Provenance

**Prove your writing is human-crafted with verifiable proof of the creative process.**

---

## Why Provenance Exists

AI can now generate text indistinguishable from human writing. Readers can't tell what's real. Writers who do the work have no way to prove it. AI detectors are unreliable and easily fooled -- they analyze the *output*, but the output isn't what makes human writing human.

The things that make AI effective -- speed and precision -- are the opposite of what makes human writing human: the pondering, the false starts, the typos corrected, the paragraph rewritten three times at 2am.

Provenance captures that process. Every keystroke, every pause, every deletion. The result is a `.provenance` file -- a portable, tamper-resistant proof that a human sat down and wrote something.

Think of it like a live concert recording. Studio albums may be technically "better," but there's something irreplaceable about proof that a human actually performed it.

---

## How It Works

### Writing

1. Open Provenance in your browser (it runs locally on your machine)
2. Write in the markdown editor -- it works like any other editor
3. In the background, every input event is recorded with precise timestamps
4. Your work auto-saves to a local vault folder
5. Come back tomorrow and keep writing -- multi-session documents strengthen the proof

### Verifying

1. Open a `.provenance` file in the Verify tab
2. Watch the entire writing process replayed -- the thinking, the mistakes, the revisions
3. See human patterns: typing bursts, long pauses, corrections across sessions
4. Check the hash chain integrity to confirm nothing was tampered with
5. See the paste ratio -- how much was composed vs. imported from external sources

### What Makes Forgery Hard

- **Rolling hash chain**: Each event's hash includes the previous event's hash. Modify one event and every subsequent hash breaks.
- **Behavioral capture**: Timing patterns, pause durations, and error corrections are recorded at millisecond precision.
- **Multi-day sessions**: Forging a proof would mean "performing" the writing process in real time, across multiple sittings.
- **Paste detection**: External paste events are flagged and tracked separately from composed content.

---

## Getting Started

### Requirements

- Node.js v18 or higher
- npm
- A modern browser (Chrome or Edge recommended for vault auto-save via File System Access API)

### Install and Run

```bash
git clone https://github.com/AnshumanV/provenance.git
cd provenance
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Production Build

```bash
npm run build
npm start
```

Serves the app at `http://localhost:3001`.

### Vault Setup

On first launch, click the vault folder button in the sidebar to select a local directory. All `.provenance` files will be saved here automatically. The vault gives you:

- Auto-save every 2 seconds while editing
- Click any file in the sidebar to resume editing
- Rename documents via the title field
- Files persist across browser sessions

> **Note:** The File System Access API (used for vault) is supported in Chrome and Edge. Other browsers fall back to manual file download.

---

## Usage

### Write Tab

Create a new document or open an existing one from the sidebar. The editor supports markdown with a live preview pane. Recording starts automatically on your first keystroke -- no setup needed.

Sessions are tracked automatically. Close the tab or switch documents, and the session ends. Come back later and a new session begins, chaining onto the previous ones.

### Verify Tab

Switch to the Verify tab and click any document in the sidebar. You'll see:

- **Replay controls**: Play, pause, speed (1x/2x/5x), skip pauses
- **Hash chain status**: Verified or broken
- **Paste ratio**: Percentage of content that was pasted from external sources vs. composed in the editor
- **Session timeline**: Visual markers for session breaks, paste events, and long pauses

---

## The .provenance File

A `.provenance` file is a self-contained JSON document with:

- **Metadata**: Title, creation date, editor version
- **Sessions**: One per writing sitting, each containing timestamped events
- **Events**: `insert`, `delete`, `paste`, `session_start`, `session_end` -- each with timestamps and positions
- **Hash chain**: Rolling SHA-256 hashes linking every event to the one before it
- **Final content**: The completed document text

The file is portable. Share it with anyone and they can load it into Provenance to verify the writing process independently.

---

## Commands

```bash
npm run dev           # Start development server (port 5173)
npm run build         # Build for production
npm start             # Run production server (port 3001)
npm test              # Run tests (watch mode)
npm run test:run      # Run tests (single run)
npm run test:coverage # Run tests with coverage report
```

---

## Project Structure

```
provenance/
├── src/
│   ├── client/
│   │   ├── index.html              # Main HTML
│   │   ├── styles/main.css         # Styles
│   │   └── js/
│   │       ├── app.js              # Application orchestrator
│   │       ├── editor.js           # CodeMirror 6 editor
│   │       ├── editorRecorder.js   # Editor-to-recorder bridge
│   │       ├── viewer.js           # Replay viewer
│   │       ├── vault.js            # File System Access API
│   │       ├── sidebar.js          # Sidebar UI
│   │       └── autosave.js         # Auto-save logic
│   ├── server/
│   │   └── index.js                # Express server
│   └── core/
│       ├── recorder.js             # Event recording + hash chain
│       ├── hasher.js               # SHA-256 rolling hash
│       ├── format.js               # .provenance file format
│       └── postprocess.js          # Analysis pipeline (paste ratio, etc.)
├── tests/                          # Test suite (Vitest + jsdom)
├── package.json
├── CLAUDE.md                       # Development notes
└── LICENSE                         # BSL 1.1
```

---

## Design Principles

- **Local-first**: No cloud, no accounts, no tracking. Writers own their data.
- **Portable proofs**: A single file contains everything needed for verification.
- **Process over output**: The proof is the journey, not the destination.
- **Paste is not cheating**: Writers paste from their own notes, quotes, and references. Provenance flags it transparently and lets readers decide.

---

## Contributing

Contributions are welcome. Please follow the project's commit conventions:

```
feat: description     # New features
fix: description      # Bug fixes
refactor: description # Code restructuring
docs: description     # Documentation
chore: description    # Maintenance
```

Branch from `main` for features (`feature/name`) and fixes (`fix/name`).

---

## License

Licensed under the [Business Source License 1.1](LICENSE).

You can use, modify, and share this software freely for non-production purposes (development, testing, personal use, education). Production use in a commercial product or service requires a commercial license.

On **February 18, 2030**, the license automatically converts to [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0), making it fully open source.

See the [LICENSE](LICENSE) file for the complete terms.
