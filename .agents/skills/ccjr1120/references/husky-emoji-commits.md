# Husky + Emoji Commits

Auto-prefix commit messages with emoji based on conventional commit type.

## 1. Install & Initialize

```bash
npm install --save-dev husky
npx husky init
```

## 2. Configure pre-commit Hook

Clear pre-commit file conent.

## 3. Configure commit-msg Hook

**.husky/commit-msg:**

```bash
node "$(dirname -- "$0")/prefix-emoji.mjs" "$1"
```

> `$1` is the path to the commit message file (typically `.git/COMMIT_EDITMSG`).

## 4. Add Emoji Prefix Script

**.husky/prefix-emoji.mjs:**

```js
import { readFileSync, writeFileSync } from "fs";

const EMOJI_MAP = {
  init: "🌱",
  feat: "✨",
  wip: "💬",
  fix: "🔨",
  docs: "📝",
  style: "🎨",
  refactor: "♻️",
  test: "✅",
  chore: "📦️",
  release: "🚀",
};

const msgFile = process.argv[2];
const msg = readFileSync(msgFile, "utf8").trim();

// Extract type from "type:" or "type(scope):"
const typeMatch = msg.match(/^([a-z]+)(?:\([^)]*\))?:/);
const type = typeMatch ? typeMatch[1] : null;
const emoji = type ? EMOJI_MAP[type] : "🏷️";

if (emoji && !msg.startsWith(emoji)) {
  writeFileSync(msgFile, `${emoji} ${msg}\n`, "utf8");
}
```

**Result:** `feat: add login` → `✨ feat: add login`
