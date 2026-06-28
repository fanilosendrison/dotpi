# Creating Extensions

Setting up TypeScript editor support for Pi extensions when the Pi SDK is
installed globally (not in a local `node_modules/`).

## The Setup

Pi extensions import from three packages:

| Package | Purpose |
|---------|---------|
| `@earendil-works/pi-coding-agent` | Extension types (`ExtensionAPI`, events, tools) |
| `@earendil-works/pi-ai` | AI utilities (`StringEnum`) |
| `@earendil-works/pi-tui` | TUI components |

These live in the global npm root (`$(npm root -g)/@earendil-works/pi-coding-agent/`).
`pi-ai` and `pi-tui` are nested inside `pi-coding-agent/node_modules/`, not at the
global root.

## tsconfig.json

Use `paths` with absolute paths pointing to the global npm root.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "preserve",
    "moduleResolution": "bundler",
    "baseUrl": ".",
    "paths": {
      "@earendil-works/pi-coding-agent": [
        "<npm root -g>/@earendil-works/pi-coding-agent"
      ],
      "@earendil-works/pi-ai": [
        "<npm root -g>/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai"
      ],
      "@earendil-works/pi-tui": [
        "<npm root -g>/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui"
      ]
    },
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "ignoreDeprecations": "6.0"
  },
  "include": ["extensions/**/*.ts"]
}
```

Key points:
- `moduleResolution: "bundler"` — `"node"` was removed in TypeScript 6.0
- `baseUrl` is deprecated in TS 6.0; `ignoreDeprecations: "6.0"` suppresses the warning
- Paths must be **absolute** — relative paths in `paths` resolve from `baseUrl`, which
  cannot reach the global npm root
- No `package.json` or `node_modules/` needed — the paths handle everything

