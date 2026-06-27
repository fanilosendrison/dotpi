# Harness Config

This file is the map to `~/.pi/agent/` — every customization made to your own Pi harness, and the workflows for making them. You loaded it because the user asked about modifying you or your own harness.

Harness modifications are organized as topics under `pi-itself/`. Each topic has its own folder. You drop into a folder, read its `CONTEXT.md`, do your work, and exit.

Pi documentation lives at: `$(npm root -g)/@earendil-works/pi-coding-agent/docs/`

## Folder Structure

```
~/.pi/agent/
├── AGENTS.md               ← Start here. (always loaded)
├── CONTEXT.md              ← You are here (topic router)
├── documenting-self-modifications/
│   └── CONTEXT.md          ← Document a modification of your own harness
├── auth.json               ← Provider credentials (gitignored)
├── auth.json.example       ← Template for auth.json (committed)
├── settings.json           ← Global settings
├── bin/                    ← fd, rg (Rust binaries for find/grep, faster than Node.js)
├── pi-itself/              ← Modify your own harness
│   ├── CONTEXT.md          ← Index of all modifications
│   └── managing-api-keys/  ← Manage API keys
│       └── CONTEXT.md
└── sessions/               ← Pi's session history
```

## Quick Navigation

| Want to... | Go here |
|------------|---------|
| Add / modify an API key | `pi-itself/managing-api-keys/CONTEXT.md` |
| Understand API key naming | `pi-itself/managing-api-keys/CONTEXT.md` |
| Document a new harness modification | `documenting-self-modifications/CONTEXT.md` |
| See all harness modifications | `pi-itself/CONTEXT.md` |

---

## ID & Naming Conventions

Every file and folder created under `~/.pi/agent/` follows these conventions.

### Folders

| Rule | Example |
|------|---------|
| `kebab-case` | `managing-api-keys`, `pi-itself` |
| Name = action or domain, never an ID number | `managing-api-keys` not `topic-3` |

### Files

| Type | Pattern | Example |
|------|---------|---------|
| Topic context | `CONTEXT.md` in every topic folder | `pi-itself/managing-api-keys/CONTEXT.md` |
| Template for gitignored files | `*.example`, committed | `auth.json.example` |

---

## Writing Rules

Every file you write under `~/.pi/agent/` must follow these rules:

- All English.
- Tables: separator dashes match header column widths exactly.
- No markdown lint violations.
- Do not leak infrastructure details: use placeholders (`<project>`, `<config>`, `<agent_name>`) instead of real project/config names. Concrete values live in gitignored files only.
