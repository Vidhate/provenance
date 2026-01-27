# Provenance

## Vision

Provenance is a tool that provides irrefutable proof that written content was created by a human through authentic human processes - not AI-generated or heavily edited from AI output.

As AI models become capable of generating content indistinguishable from human writing in quality, the *process* of creation becomes the differentiator. Just as live concerts have seen increased value despite studio recordings being technically "better," human-written content will carry intrinsic value when its authenticity can be verified.

**Core thesis:** The exact things that make AI effective (speed and accuracy) are the opposite of what makes humans human (creative pondering and mistakes). Provenance captures and proves these human characteristics.

## Threat Model

Writers and readers face a trust problem:
- Readers cannot know if content they're consuming is AI-generated or human-written
- Writers who craft original content have no way to prove their authenticity
- Existing solutions (AI detectors) are unreliable and easily fooled

Provenance solves this by capturing the *process* of writing, not just the output. A proof exists that can be verified by anyone - the mere existence of verifiable proof becomes a mark of trust (similar to ISO certification).

## How It Works

### For Writers
1. Install and run Provenance locally (`npm install`)
2. Write in the built-in markdown editor
3. Every keystroke, pause, deletion, and copy-paste is recorded with precise timestamps
4. Sessions can span days or weeks (making forgery even harder)
5. Export a `.provenance` file - a portable proof of the writing process

### For Readers
1. Load a `.provenance` file in the replay viewer
2. Watch the writing process unfold - see the thinking, the mistakes, the revisions
3. Observe human patterns: typing bursts, long pauses for thought, corrections, session breaks across days

### Tamper Resistance
- Rolling hash chain: each event's hash includes the previous event's hash
- Modifying any event breaks all subsequent hashes
- The chain creates internal consistency that's verifiable

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    WRITER'S MACHINE                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Local Web App (localhost:3000)             │   │
│  │  ┌─────────────┐    ┌─────────────────────────────┐ │   │
│  │  │  Markdown   │───▶│   Background Recorder       │ │   │
│  │  │   Editor    │    │   - Keystrokes + timing     │ │   │
│  │  │             │    │   - Cursor position         │ │   │
│  │  └─────────────┘    │   - Copy/paste events       │ │   │
│  │                     │   - Pause durations         │ │   │
│  │                     └───────────┬─────────────────┘ │   │
│  └─────────────────────────────────┼───────────────────┘   │
│                                    ▼                        │
│                    ┌───────────────────────────┐            │
│                    │   .provenance file        │            │
│                    │   (portable proof asset)  │            │
│                    └───────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Writer shares file
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    READER'S MACHINE                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Replay Viewer                           │   │
│  │  ┌─────────────────────────────────────────────────┐ │   │
│  │  │   Playback of writing process                   │ │   │
│  │  │   - Speed controls (1x, 2x, 5x, skip pauses)    │ │   │
│  │  │   - Visual markers for paste, pauses, sessions  │ │   │
│  │  └─────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack (MVP)

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js + Express | Simple, familiar to developers |
| Frontend | Vanilla JS or Preact/Svelte | Fast, minimal dependencies |
| Editor | CodeMirror 6 | Excellent markdown support, extensible, good event access |
| Storage | Local filesystem | `.provenance` files saved to project directory |
| Build | Vite | Fast dev experience |

## MVP Features

### Writer Mode
- Markdown editor with live preview (split or toggle view)
- Background recording of all input events with timestamps
- Copy/paste detection (flagged distinctly in the proof)
- Save/resume sessions across days
- Export `.provenance` file

### Reader Mode
- Load `.provenance` file
- Replay writing process with speed controls
- Visual indicators for: typing, deleting, pasting, long pauses, session breaks
- Final document view

### Proof File Format (JSON for MVP)
```json
{
  "version": "1.0.0",
  "metadata": {
    "title": "Document title",
    "createdAt": "2024-01-15T09:00:00Z",
    "lastModifiedAt": "2024-01-18T21:45:00Z",
    "editorVersion": "1.0.0"
  },
  "sessions": [
    {
      "id": "session-uuid",
      "startTime": "2024-01-15T09:00:00Z",
      "endTime": "2024-01-15T11:30:00Z",
      "events": [
        {
          "type": "insert",
          "timestamp": 1705312800000,
          "position": 0,
          "content": "H",
          "hash": "abc123..."
        },
        {
          "type": "insert",
          "timestamp": 1705312800150,
          "position": 1,
          "content": "e",
          "hash": "def456..."
        },
        {
          "type": "paste",
          "timestamp": 1705312900000,
          "position": 100,
          "content": "pasted text here",
          "hash": "ghi789..."
        }
      ]
    }
  ],
  "finalContent": "The complete final document...",
  "contentHash": "final-document-hash"
}
```

### Event Types
- `insert` - Character(s) typed
- `delete` - Character(s) removed
- `paste` - Content pasted from clipboard
- `cursor` - Cursor position change (optional, may be verbose)
- `selection` - Text selection (optional)
- `session_start` - New writing session began
- `session_end` - Writing session ended

## Target Audience

**MVP:** Developer-bloggers who can run `npm install` and appreciate verified human writing

**Future:** Platforms and publishers (Twitter/X, LinkedIn, Medium) who want to verify content authenticity at scale

---

## Future Roadmap

### Version 2: Statistical Analysis
- [ ] Generate statistical summary of writing patterns
- [ ] Metrics: words per minute over time, pause frequency, revision patterns
- [ ] Copy-paste ratio and source flagging
- [ ] "Human score" based on behavioral patterns
- [ ] Anomaly detection for AI-assisted sections

### Version 3: Verification Badge
- [ ] Visual badge/stamp for verified content
- [ ] Embeddable widget for blogs/websites
- [ ] "Verified by Provenance" certification
- [ ] Badge links to proof viewer

### Version 4: Cryptographic Anchoring
- [ ] Anchor hashes to public timestamping service or blockchain
- [ ] Proves recording wasn't fabricated retroactively
- [ ] External verification independent of Provenance

### Version 5: Binary Format
- [ ] Move from JSON to binary format
- [ ] Smaller file sizes
- [ ] Harder to manually tamper with
- [ ] Consider: Protocol Buffers, MessagePack, or custom format

### Version 6: Platform Integration
- [ ] API for platforms to verify content
- [ ] Bulk verification tools
- [ ] Publisher dashboard
- [ ] Browser extension for readers to check articles

### Version 7: Privacy Options
- [ ] Statistical proof without full replay
- [ ] Redact sections while maintaining proof integrity
- [ ] Selective disclosure of writing process

### Technical Debt & Improvements
- [ ] Optimize event storage (batch small rapid keystrokes)
- [ ] Compression for large documents
- [ ] Offline-first with sync capabilities
- [ ] Mobile support

---

## Development Notes

### Key Design Decisions
1. **Local-first**: No cloud, no auth, writers own their data
2. **Portable proof files**: Single file contains everything needed for verification
3. **Process over output**: The proof is the journey, not the destination
4. **Multi-session support**: Writing across days strengthens the proof

### What Makes Forgery Hard
1. **Behavioral capture**: Timing patterns, pause durations, error corrections
2. **Rolling hash chain**: Internal consistency check
3. **Multi-day sessions**: Would require "performing" writing over extended time
4. **Statistical fingerprinting** (future): Human typing has distinctive patterns

### Copy-Paste Philosophy
Copy-paste isn't inherently bad - writers copy from their own notes, quotes, code snippets. The key is:
1. Detecting and flagging paste events
2. Showing what was pasted and when
3. Letting readers make their own judgment
4. Future: Contributing to a "human score" metric

---

## Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Run production server
npm start
```

## Project Structure

```
provenance/
├── CLAUDE.md           # This file - project context and notes
├── package.json
├── src/
│   ├── server/         # Express server
│   ├── client/         # Frontend (editor + viewer)
│   │   ├── editor/     # Markdown editor with recording
│   │   ├── viewer/     # Replay viewer
│   │   └── shared/     # Shared components
│   └── core/           # Core logic
│       ├── recorder.js # Event recording logic
│       ├── hasher.js   # Rolling hash implementation
│       └── format.js   # .provenance file format
├── public/             # Static assets
└── docs/               # User documentation
```
