# Provenance

**Irrefutable proof that writing was created by a human, through an authentic human process.**

[**Try the demo →**](https://provenance-sand.vercel.app) &nbsp;·&nbsp; [BSL 1.1 License](LICENSE)

---

## The Problem

AI can now generate text indistinguishable from human writing in quality. Detectors don't work — they analyze the output, but the output isn't what makes human writing human.

Writers who do the real work have no way to prove it. Readers have no way to know.

## The Insight

Speed and single-burst generation are what make AI effective. Mistakes, creative detours, and rumination are what make us human.

When a person writes something real, they don't produce it in one clean pass. They stop mid-sentence to think. They delete a paragraph and rewrite it from a different angle. They walk away, come back two days later, restructure the whole thing. They mistype, reconsider, get stuck, push through. That messy, nonlinear process is the signature of authentic thought — and it's nearly impossible to fake convincingly at scale.

Provenance captures that process. The proof isn't the writing. It's the *journey*.

> Think of it like a live concert. Studio recordings may be technically perfect, but there's something irreplaceable about proof that a human actually performed it — in time, with friction.

## How It Works

Every keystroke, pause, deletion, and revision is recorded with precise timestamps as you write. When you're done, you export a `.provenance` file — a portable, self-contained artifact containing the complete record of how the document came to exist.

Anyone can load that file and watch the writing unfold: the false starts, the long pauses mid-paragraph, the sections rewritten from scratch. The replay is the proof.

### For Writers

1. Open Provenance in Chrome or Edge (runs locally — no account, no cloud)
2. Write normally in the markdown editor
3. Every event is recorded in the background with millisecond timestamps
4. Your work auto-saves to a local vault folder
5. Come back tomorrow and keep writing — multi-session documents strengthen the proof
6. Export a `.provenance` file to share

### For Readers

1. Load a `.provenance` file in the Verify tab
2. Watch the entire writing process replay — including the thinking, the mistakes, the revisions
3. See human behavioral patterns: typing bursts, long pauses, corrections, session breaks across days
4. Inspect the hash chain integrity to confirm nothing was tampered with

### What Makes Forgery Hard

- **Rolling hash chain** — each event's hash includes the previous event's hash. Modify one event and every subsequent hash breaks. No central authority required to verify.
- **Behavioral capture** — timing patterns, pause durations, and error corrections are recorded at millisecond precision. Human typing is statistically distinctive.
- **Multi-day sessions** — forging a proof means performing the writing process in real time, across multiple sittings. The longer the document, the harder the forgery.
- **Paste detection** — external paste events are flagged and tracked separately. Provenance doesn't judge; it makes the record visible.

---

## The `.provenance` Format

A single portable JSON file. No server. No dependency on Provenance's infrastructure. Anyone can verify independently.

```json
{
  "version": "1.0.0",
  "metadata": {
    "title": "My Essay",
    "createdAt": "2024-01-15T09:00:00Z",
    "lastModifiedAt": "2024-01-18T21:45:00Z"
  },
  "sessions": [
    {
      "id": "session-uuid",
      "startTime": "2024-01-15T09:00:00Z",
      "events": [
        { "type": "insert", "timestamp": 1705312800000, "position": 0, "content": "H", "hash": "abc123" },
        { "type": "delete", "timestamp": 1705312805000, "position": 0, "length": 1, "hash": "def456" },
        { "type": "paste",  "timestamp": 1705312900000, "position": 100, "content": "...", "hash": "ghi789" }
      ]
    }
  ],
  "finalContent": "The complete document...",
  "contentHash": "sha256-of-final-content"
}
```

---

## Getting Started

**Requirements:** Node.js v18+, npm, Chrome or Edge (for vault auto-save via File System Access API)

```bash
git clone https://github.com/avidhate/provenance.git
cd provenance
npm install
npm run dev
```

Open `http://localhost:5173`. Select a vault folder when prompted — this is where your `.provenance` files will auto-save every 2 seconds.

Or skip the install and use the [hosted demo](https://provenance-sand.vercel.app).

---

## Commands

```bash
npm run dev           # Development server (port 5173)
npm run build         # Production build
npm start             # Production server (port 3001)
npm test              # Tests in watch mode
npm run test:run      # Single test run
npm run test:coverage # Coverage report
```

---

## Project Structure

```
provenance/
├── src/
│   ├── client/
│   │   ├── index.html
│   │   ├── styles/main.css
│   │   └── js/
│   │       ├── app.js              # Application orchestrator
│   │       ├── editor.js           # CodeMirror 6 editor
│   │       ├── editorRecorder.js   # Editor → recorder bridge
│   │       ├── viewer.js           # Replay with speed controls
│   │       ├── vault.js            # File System Access API wrapper
│   │       ├── sidebar.js          # File list UI
│   │       └── autosave.js         # Interval-based auto-save
│   ├── server/
│   │   └── index.js                # Express server
│   └── core/
│       ├── recorder.js             # Event recording + hash chain
│       ├── hasher.js               # SHA-256 rolling hash
│       ├── format.js               # File format & validation
│       └── postprocess.js          # Analysis pipeline (paste ratio, etc.)
├── tests/                          # Vitest + jsdom
└── package.json
```

**Tech:** Node.js · Express · CodeMirror 6 · Vanilla JS · Vite · Vitest

---

## Roadmap

This is a proof of concept — the core recording and replay loop works end to end. What's next:

- **Statistical fingerprinting** — WPM variance, pause frequency distributions, revision patterns — to generate a quantitative authenticity signal beyond the binary hash check
- **Verification badge** — an embeddable widget writers can drop on their blog or portfolio that links to the proof, similar to how open source projects display build status
- **Cryptographic anchoring** — anchor the final hash to a public timestamping service (RFC 3161) to prove the proof itself wasn't fabricated retroactively
- **Privacy modes** — statistical proof without full replay, for writers who want to verify authenticity without exposing their complete creative process
- **Platform API** — for publishers and platforms to verify content authenticity at scale

---

## Design Principles

- **Local-first** — no cloud, no accounts, no tracking. Writers own their data and their proof.
- **Portable proofs** — a single file contains everything needed for independent verification.
- **Process over output** — the proof is the journey, not the destination.
- **Paste is not cheating** — writers paste from their own notes, quotes, and references. Provenance flags it transparently and lets readers decide what it means.

---

## Contributing

Contributions welcome. Please follow conventional commits:

```
feat: description     # New features
fix: description      # Bug fixes
refactor: description # Code restructuring
docs: description     # Documentation
```

Branch from `main` for features (`feature/name`) and fixes (`fix/name`).

---

## License

Licensed under the [Business Source License 1.1](LICENSE) · © 2024 Aditya Vidhate

Free for non-production use: development, research, personal projects, and internal business use. You may not offer Provenance or a substantially similar service to third parties on a commercial basis without a license.

Automatically converts to **Apache 2.0 on February 18, 2030**, at which point it becomes fully open source.

---

Built by [Aditya Vidhate](https://github.com/avidhate).
