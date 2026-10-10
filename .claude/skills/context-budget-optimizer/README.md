# Context Budget Optimizer

A custom Claude skill (not the Context Mode plugin). It gives Claude a read-only, standard-library Python script that ranks files for a query and prints short, line-numbered, redacted excerpts, plus instructions that avoid full-file dumps and verbose rebuilds.

No dependencies: Python 3.8+ only.

## Install in claude.ai
1. Settings → Capabilities: enable "Code execution and file creation".
2. Customize → Skills → + → Create skill → Upload a skill.
3. Upload `context-budget-optimizer.zip` and enable it.
4. Test: attach a source-code ZIP and ask "Use context-budget-optimizer to find the code behind the login errors."

## Install in Claude Code
Copy the `context-budget-optimizer` folder to `~/.claude/skills/` (all projects) or to `<project>/.claude/skills/` (one project).

## Check it works
```
python3 scripts/test_context_pack.py
python3 scripts/context_pack.py --root . --query "login session expired" --files-only
```

## Limits
It cannot intercept other tools, guarantee savings, change account usage limits, or run as an MCP server in Claude web. Redaction catches common secret formats, not every possible one.

The original Context Mode for Claude Code: https://github.com/mksglu/context-mode
