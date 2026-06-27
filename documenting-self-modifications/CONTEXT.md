Follow these steps to document a harness modification.

## STEP 1. Choose the title and write CONTEXT.md

Start with a good title: `# <Action or Domain>`. Keep it short and `kebab-case` ready (e.g. `Managing API Keys` → `managing-api-keys`).

You are writing for your future self — when you read this again, you need to understand what was done and how to act on it immediately. Reference `pi-itself/managing-api-keys/CONTEXT.md` as the canonical example for tone, table formatting, and section depth.

Sections, in this order:

**Where / What** — critical context first.
- If keys/resources: where they live.
- If a convention: state it upfront with placeholders for infra (e.g. project `<agent_name>`, config `<config>`).
- Use a table if there are multiple items.

**How It Works** — operational details.
- Show the exact command or code block.
- Include a placeholders reference table if the command has variables.
- Mention any noteworthy behavior (e.g. "executed on every request, no caching").

**Relevant Files** — table with columns: File, Purpose, Versioned (✅/❌).
- Every file the agent might need to read or edit.

**Background** — brief: what was changed and why. Keep it short.

---

The steps below are mechanical. Execute them exactly.

---

## STEP 2. Write the file

Derive `<topic>` from the title you chose in STEP 1: `# Managing API Keys` → `managing-api-keys`. Write to:

```
pi-itself/<topic>/CONTEXT.md
```

---

## STEP 3. Update the index

Add an entry in `pi-itself/CONTEXT.md` under "Existing Modifications":
```
### N. <Title>
- **Date** : YYYY-MM-DD
- **Doc** : [`<topic>/CONTEXT.md`](<topic>/CONTEXT.md)
```

---

## STEP 4. Update the router

Add a row in `AGENTS.md` Quick Navigation table.
