---
name: UI Language Rule
description: The app UI must always be in English, regardless of chat language.
---

## Rule
All app text — labels, buttons, headings, empty states, toasts, error messages, tab names — must be written in English.

**Why:** The user writes in Arabic but explicitly confirmed the app itself should always be in English. Arabic in the UI is a bug.

**How to apply:** Any time you write or edit a `.tsx` or `.ts` file in `artifacts/trading-bot/src`, use English for all user-facing strings. If you see Arabic text in existing code, translate it to English as part of the edit.
