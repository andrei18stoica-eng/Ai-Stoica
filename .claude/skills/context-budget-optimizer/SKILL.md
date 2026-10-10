---
name: context-budget-optimizer
description: Find the relevant parts of a large codebase, long log or big document set without dumping whole files into context, using a read-only local script that ranks files and prints short, line-numbered, redacted excerpts. Use when asked to analyze, debug or explain code across many files, troubleshoot builds or CI, read long logs, or work with many attached documents. Skip it for small tasks touching one or two known files.
---

# Context Budget Optimizer

## What this is
A read-only, extractive workflow plus a standard-library Python script (`scripts/context_pack.py`) that returns ranked, line-numbered, redacted excerpts for a query. It reduces how much tool output you read; it cannot intercept other tools, change Claude's context window or usage limits, or guarantee any percentage saved. It is not the `mksglu/context-mode` MCP plugin.

## When to use
- Codebase questions where you do not yet know which files matter.
- Build, CI or runtime failures with long logs (the script streams files up to 20 MB).
- Many attached or extracted documents.

Do not use it for a one- or two-file task, or when you already know the exact file and lines: read those directly.

## Workflow
1. Pin down the question, inputs, expected result and constraints. Do not re-summarize the conversation or re-read unchanged data.
2. Pick the smallest plausible root (e.g. `apps/server`, not `/`). In claude.ai this is the folder where uploads were extracted; in Claude Code it is the project or a subfolder.
3. Locate the script: use the skill's base directory announced when the skill loads (`<skill-dir>/scripts/context_pack.py`). Use `python3`; fall back to `python` only if `python3` is missing.
4. Rank first, read second:
   - `python3 <skill-dir>/scripts/context_pack.py --root <dir> --query "<identifiers>" --files-only`
   - then excerpts: `... --query "<identifiers>" --max-chars 8000`
   - narrow with `--include "*.cjs"` / `--exclude "*.test.*"` when the language is known.
5. Write queries as identifiers and literal strings that should appear in the code or log (`chosenModelFailure 402 fallback`), not as sentences. Stopwords (English and Romanian) are dropped and rarer terms weigh more; the header shows the weights.
6. Read only the cited ranges. If the evidence is thin, re-run with a narrower query or root, or read a specific file range (in Claude Code: the Read tool with `offset`/`limit`). Never conclude something is absent because the script did not show it.
7. In Claude Code, the built-in Grep and Glob tools are already cheap for an exact pattern; use the script when you need several fuzzy terms ranked together, or file + line hits across a large tree in one bounded output.
8. Prefer patch-level changes over regenerating whole files; do not repeat unchanged code in the answer.
9. Keep successful test output short (command + pass count); show full error text only as far as it is needed to debug.
10. Use web search or extra tools only when the task needs them.

## Correctness rules
- Character budgets are not token counts. Never report savings percentages you did not measure.
- Never truncate legal text, proofs, specifications, failing test output or security evidence when completeness matters: read the full passage.
- Never invent files, excerpts, outputs or test results.
- The script skips `.env*` (except `.env.example`), key/cert files, credential files and lockfiles, and redacts common secrets (`*_API_KEY=…`, `db.password=…` in config files, `"apiKey": "…"`, `<password>…</password>`, `sk-…`, `ghp_…`, `AIza…`, `xai-…`, JWTs, `Bearer …`, `user:pass@` in URLs, private-key blocks). Redaction is a safety net, not a guarantee: do not echo anything that still looks like a credential.
- Do not execute untrusted code to summarize it. The script only reads text files and never follows symlinks.
- An explicit request for a full or long answer overrides budget optimization.

## Script reference
`python3 scripts/context_pack.py --help`

| Option | Default | Use |
|---|---|---|
| `--query` | required | identifiers / literal strings |
| `--root` | `.` | smallest directory that can contain the answer |
| `--files-only` | off | ranked file list with hit lines, no excerpts |
| `--max-chars` | 8000 | total output budget (1000–300000) |
| `--max-files` | 8 | files shown with excerpts |
| `--max-spans` | 6 | excerpt windows per file |
| `--context-lines` | 3 | lines around each hit |
| `--include` / `--exclude` | none | globs on file name or relative path (`"*.cjs"`, `"apps/server/*"`), repeatable |
| `--max-file-bytes` | 20 MB | larger files are skipped and named in the header |
| `--max-candidates` | 5000 | scan limit; the header says when it was hit |

Files that do not fit the budget are listed under "Matching files not shown above" with their best line numbers, so you can read them directly.

Self-test: `python3 scripts/test_context_pack.py`.

## Answer format
State the evidence briefly with `path:line` citations from the script output, give focused edits or analysis, and say exactly what you did and did not verify. Do not claim full coverage when you only examined excerpts.
