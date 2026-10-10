#!/usr/bin/env python3
"""Read-only, extractive code/file context selector for a Claude skill.

Pure standard-library Python (3.8+). It never executes target files, uses the
network, installs packages or touches Claude's context window. It only reads
text files under --root and prints ranked, line-numbered, redacted excerpts.

Two passes keep memory flat even on large logs:
  1. stream every candidate file, record which lines match which terms;
  2. re-read only the files that will be shown and print the chosen windows.
"""

from __future__ import annotations

import argparse
import fnmatch
import math
import os
import re
import sys
from collections import Counter
from pathlib import Path

ALLOW_EXT = {
    ".py",
    ".pyi",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".cjs",
    ".mjs",
    ".cts",
    ".mts",
    ".json",
    ".jsonc",
    ".md",
    ".mdx",
    ".rst",
    ".txt",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".properties",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".html",
    ".htm",
    ".vue",
    ".svelte",
    ".astro",
    ".sql",
    ".prisma",
    ".graphql",
    ".gql",
    ".proto",
    ".sh",
    ".bash",
    ".zsh",
    ".ps1",
    ".psm1",
    ".bat",
    ".cmd",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".kts",
    ".scala",
    ".groovy",
    ".gradle",
    ".c",
    ".h",
    ".cc",
    ".cpp",
    ".hpp",
    ".cs",
    ".fs",
    ".swift",
    ".m",
    ".mm",
    ".php",
    ".rb",
    ".ex",
    ".exs",
    ".erl",
    ".dart",
    ".lua",
    ".r",
    ".jl",
    ".pl",
    ".tf",
    ".hcl",
    ".nix",
    ".xml",
    ".plist",
    ".csv",
    ".tsv",
    ".log",
    ".out",
    ".err",
    ".diff",
    ".patch",
    ".tex",
}
ALLOW_NAMES = {
    "Dockerfile",
    "Containerfile",
    "Makefile",
    "GNUmakefile",
    "Procfile",
    "Caddyfile",
    "Jenkinsfile",
    "Vagrantfile",
    "Gemfile",
    "Rakefile",
    "README",
    "LICENSE",
    "CHANGELOG",
    "CODEOWNERS",
}
# Generated, vendored or VCS-internal directories. Other hidden directories
# (.github, .claude, .vscode, .circleci, ...) are searched on purpose: CI and
# tooling config is often exactly what a build question needs.
SKIP_DIRS = {
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "bower_components",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".output",
    "dist",
    "build",
    "out",
    "coverage",
    ".nyc_output",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    "target",
    ".gradle",
    ".idea",
    ".cache",
    ".turbo",
    ".parcel-cache",
    "vendor",
    "Pods",
    "DerivedData",
}
SKIP_SUFFIXES = (
    ".lock",
    ".map",
    ".min.js",
    ".min.css",
    ".bundle.js",
    ".pem",
    ".key",
    ".crt",
    ".cer",
    ".p12",
    ".pfx",
    ".jks",
    ".keystore",
    ".kdbx",
    ".sqlite",
    ".sqlite3",
    ".db",
)
LOCKFILES = {
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "composer.lock",
    "poetry.lock",
    "cargo.lock",
    "gemfile.lock",
    "go.sum",
    "uv.lock",
    "bun.lockb",
}
SECRET_NAMES = {
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    ".npmrc",
    ".pypirc",
    ".netrc",
    ".git-credentials",
    ".htpasswd",
    "credentials",
    "credentials.json",
    "secrets.json",
    "secrets.yaml",
    "secrets.yml",
    "service-account.json",
}
ENV_TEMPLATES = {".env.example", ".env.sample", ".env.template"}

# `key = value` / `"key": "value"` where the key name ENDS in a secret word
# (OPENAI_API_KEY, xaiApiKey, db_password, "client_secret", maxTokens ...).
# Ending, not containing: "author", "tokenizer" and "passwordPolicy" are not
# secrets and must stay readable.
SECRET_ASSIGN_RE = re.compile(
    r"""(?ix)
    (\b[\w.-]*?
        (?:api[_-]?key|apikey|secret(?:[_-]?key)?|token|passw(?:or)?d|passwd|pwd|
           authorization|auth[_-]?token|credentials?|private[_-]?key|
           access[_-]?key(?:[_-]?id)?|session[_-]?key|signing[_-]?key)s?
        ["']?\s*(?:=|:|=>|:=)\s*)
    (["'`]?)([^\s"'`,;{}()<>]{6,})
    """
)
# Well-known token formats, redacted wherever they appear.
TOKEN_RES = [
    re.compile(
        r"\bsk-(?:proj-|ant-|or-)?[A-Za-z0-9_-]{16,}"
    ),  # OpenAI / Anthropic / OpenRouter
    re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}"),  # GitHub
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bglpat-[A-Za-z0-9_-]{16,}"),  # GitLab
    re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),  # AWS
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}"),  # Google
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),  # Slack
    re.compile(r"\bxai-[A-Za-z0-9]{16,}"),  # xAI
    re.compile(r"\bgsk_[A-Za-z0-9]{20,}"),  # Groq
    re.compile(r"\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}"),  # Stripe
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),  # JWT
]
BEARER_RE = re.compile(r"(?i)\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{10,}")
URL_CRED_RE = re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://[^\s:/@]+:)[^\s@/]+@")
KEY_BEGIN_RE = re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")
KEY_END_RE = re.compile(r"-----END [A-Z0-9 ]*PRIVATE KEY-----")
NOT_SECRET = {
    "true",
    "false",
    "null",
    "none",
    "undefined",
    "required",
    "optional",
    "string",
    "number",
    "boolean",
    "redacted",
}

STOPWORDS = {
    # English
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "can",
    "do",
    "does",
    "for",
    "from",
    "how",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "me",
    "my",
    "no",
    "not",
    "of",
    "on",
    "or",
    "our",
    "so",
    "that",
    "the",
    "their",
    "then",
    "there",
    "this",
    "to",
    "was",
    "we",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "will",
    "with",
    "you",
    "your",
    "find",
    "show",
    "code",
    "file",
    "files",
    "please",
    # Romanian
    "si",
    "și",
    "sau",
    "de",
    "la",
    "cu",
    "pe",
    "din",
    "în",
    "un",
    "una",
    "o",
    "ce",
    "cum",
    "care",
    "unde",
    "este",
    "sunt",
    "nu",
    "da",
    "mai",
    "să",
    "sa",
    "se",
    "al",
    "ale",
    "lui",
    "pentru",
    "cand",
    "când",
    "fie",
    "iar",
    "dacă",
    "daca",
    "asta",
    "acest",
    "această",
    "cod",
    "fișier",
    "fisier",
}

MAX_LINE_CHARS = 300
RESERVE_FOR_INDEX = 1200  # chars kept free for the "other matching files" list


def glob_hit(name: str, rel: str, globs) -> bool:
    return any(fnmatch.fnmatch(name, g) or fnmatch.fnmatch(rel, g) for g in globs)


def allowed(path: Path, rel: str, includes, excludes) -> bool:
    name = path.name
    low = name.lower()
    if low.startswith(".env") and low not in ENV_TEMPLATES:
        return False
    if low in SECRET_NAMES or low in LOCKFILES or low.endswith(SKIP_SUFFIXES):
        return False
    if includes and not glob_hit(name, rel, includes):
        return False
    if excludes and glob_hit(name, rel, excludes):
        return False
    return (
        path.suffix.lower() in ALLOW_EXT or name in ALLOW_NAMES or low in ENV_TEMPLATES
    )


def _assign(m) -> str:
    quote, value = m.group(2), m.group(3)
    nxt = m.string[m.end() : m.end() + 1]
    if value.lower() in NOT_SECRET or re.fullmatch(r"[\d.,_]+", value):
        return m.group(0)
    # Unquoted code references (req.body.password, getToken(), cfg[k]) are not
    # secrets; literal values in .env / YAML / JSON are.
    if not quote and ("." in value or nxt in ("(", "[", ".")):
        return m.group(0)
    return m.group(1) + quote + "<REDACTED>"


def redact(s: str) -> str:
    s = URL_CRED_RE.sub(r"\1<REDACTED>@", s)
    s = BEARER_RE.sub(lambda m: m.group(1) + " <REDACTED>", s)
    for rx in TOKEN_RES:
        s = rx.sub("<REDACTED>", s)
    return SECRET_ASSIGN_RE.sub(_assign, s)


def clip(s: str, original_len: int) -> str:
    """Cap one displayed line (minified code, base64 blobs) at MAX_LINE_CHARS."""
    if original_len <= MAX_LINE_CHARS and len(s) <= MAX_LINE_CHARS + 40:
        return s
    return s[:MAX_LINE_CHARS] + f" …[{original_len} chars total]"


def tokenize(s: str):
    words = list(dict.fromkeys(re.findall(r"[\w][\w.-]*[\w]|\w{2,}", s.lower())))
    words = [w for w in words if len(w) >= 2]
    kept = [w for w in words if w not in STOPWORDS]
    return kept or words


class Stats:
    def __init__(self):
        self.scanned = 0
        self.too_big = []
        self.binary = 0
        self.unreadable = 0
        self.limit_hit = False


def iter_files(root: Path, args, stats: Stats):
    for directory, folders, filenames in os.walk(root, followlinks=False):
        folders[:] = sorted(f for f in folders if f not in SKIP_DIRS)
        for filename in sorted(filenames):
            p = Path(directory) / filename
            rel = p.relative_to(root).as_posix()
            if p.is_symlink() or not allowed(p, rel, args.include, args.exclude):
                continue
            try:
                if not p.is_file():
                    continue
                size = p.stat().st_size
            except OSError:
                stats.unreadable += 1
                continue
            if size > args.max_file_bytes:
                stats.too_big.append(rel)
                continue
            if stats.scanned >= args.max_candidates:
                stats.limit_hit = True
                return
            stats.scanned += 1
            yield p


def text_encoding(path: Path):
    """Encoding to read the file with, or None for binary/unreadable files."""
    try:
        with path.open("rb") as fh:
            head = fh.read(4096)
    except OSError:
        return None
    if head.startswith((b"\xff\xfe", b"\xfe\xff")):
        return "utf-16"  # e.g. Windows PowerShell 5 `> file.log` / Out-File
    if b"\x00" in head:
        return None
    return "utf-8-sig"  # also strips a UTF-8 BOM


def scan_file(path: Path, terms, encoding: str):
    """Stream a file once; return (line_count, {line_index: frozenset(terms)}, term_counts)."""
    hits = {}
    counts = Counter()
    n = 0
    with path.open("r", encoding=encoding, errors="replace", newline=None) as fh:
        for n, line in enumerate(fh, 1):
            low = line.lower()
            found = frozenset(t for t in terms if t in low)
            if found:
                hits[n - 1] = found
                counts.update(found)
    return n, hits, counts


def search(root: Path, terms, args, stats: Stats):
    files = []
    df = Counter()
    for path in iter_files(root, args, stats):
        encoding = text_encoding(path)
        if encoding is None:
            stats.binary += 1
            continue
        try:
            total, hits, counts = scan_file(path, terms, encoding)
        except (OSError, UnicodeError):
            stats.unreadable += 1
            continue
        rp = path.relative_to(root).as_posix()
        in_path = frozenset(t for t in terms if t in rp.lower())
        present = set(counts) | in_path
        df.update(present)
        if present:
            files.append((rp, total, hits, counts, in_path, encoding))

    n_docs = max(stats.scanned - stats.binary - stats.unreadable, 1)
    idf = {t: math.log(1 + n_docs / (1 + df[t])) + 0.1 for t in terms}

    ranked = []
    for rp, total, hits, counts, in_path, encoding in files:
        covered = set(counts) | in_path
        # Rare terms weigh more, repeated hits saturate, covering more distinct
        # query terms beats hammering a single common one.
        body = sum(idf[t] * (1 + math.log(counts[t])) for t in counts)
        path_bonus = sum(2.5 * idf[t] for t in in_path)
        coverage = sum(idf[t] for t in covered) / sum(idf.values())
        score = (body + path_bonus) * (0.5 + coverage)
        line_scores = {i: sum(idf[t] for t in found) for i, found in hits.items()}
        ranked.append((score, rp, total, line_scores, len(covered), encoding))
    ranked.sort(key=lambda x: (-x[0], x[1]))
    return ranked, idf


def segments(line_scores, total: int, radius: int, max_spans: int):
    best = sorted(line_scores.items(), key=lambda x: (-x[1], x[0]))[:max_spans]
    if not best:
        return [(0, min(total, radius * 2 + 1))] if total else []
    windows = sorted((max(0, i - radius), min(total, i + radius + 1)) for i, _ in best)
    merged = []
    for start, stop in windows:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(stop, merged[-1][1]))
        else:
            merged.append((start, stop))
    return merged


def read_windows(root: Path, rp: str, windows, encoding: str):
    """Second pass: return {line_index: redacted text} for the requested windows only."""
    wanted = set()
    for start, stop in windows:
        wanted.update(range(start, stop))
    last = max(wanted, default=-1)
    out = {}
    in_key = False
    with (root / rp).open("r", encoding=encoding, errors="replace", newline=None) as fh:
        for i, line in enumerate(fh):
            if i > last:
                break
            text = line.rstrip("\r\n")
            if KEY_BEGIN_RE.search(text):
                in_key = True
            if i in wanted:
                if in_key:
                    out[i] = "<REDACTED PRIVATE KEY LINE>"
                else:
                    out[i] = clip(redact(text[: MAX_LINE_CHARS + 200]), len(text))
            if KEY_END_RE.search(text):
                in_key = False
    return out


def render_file(
    root: Path,
    rp: str,
    total: int,
    line_scores,
    encoding: str,
    context_lines: int,
    max_spans: int,
) -> str:
    windows = segments(line_scores, total, context_lines, max_spans)
    lines = read_windows(root, rp, windows, encoding)
    block = [f"\n## {rp} ({total} lines, {len(line_scores)} matching)\n"]
    for start, stop in windows:
        block.append(f"[lines {start + 1}-{stop}]\n")
        for i in range(start, stop):
            if i in lines:
                block.append(f"{i + 1:6d}: {lines[i]}\n")
    return "".join(block)


def main():
    ap = argparse.ArgumentParser(
        description="Print short, ranked, line-numbered, redacted excerpts matching a task query."
    )
    ap.add_argument(
        "--root", default=".", help="Directory to scan (default: current directory)"
    )
    ap.add_argument(
        "--query",
        required=True,
        help='Task keywords; identifiers work best (e.g. "fallback chosenModel 402")',
    )
    ap.add_argument(
        "--max-chars",
        type=int,
        default=8000,
        help="Output character budget (default 8000)",
    )
    ap.add_argument(
        "--max-files",
        type=int,
        default=8,
        help="Maximum files shown with excerpts (default 8)",
    )
    ap.add_argument(
        "--max-spans",
        type=int,
        default=6,
        help="Maximum excerpt windows per file (default 6)",
    )
    ap.add_argument(
        "--context-lines",
        type=int,
        default=3,
        help="Neighbouring lines around a matching line (default 3)",
    )
    ap.add_argument(
        "--max-candidates",
        type=int,
        default=5000,
        help="Safety limit on scanned files (default 5000)",
    )
    ap.add_argument(
        "--max-file-bytes",
        type=int,
        default=20_000_000,
        help="Skip files larger than this (default 20 MB)",
    )
    ap.add_argument(
        "--include",
        action="append",
        default=[],
        metavar="GLOB",
        help="Only files whose name or relative path matches GLOB (repeatable), "
        'e.g. "*.cjs" or "apps/server/*"',
    )
    ap.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="GLOB",
        help="Skip files whose name or relative path matches GLOB (repeatable)",
    )
    ap.add_argument(
        "--files-only",
        action="store_true",
        help="List ranked matching files without excerpts (cheapest first step)",
    )
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(errors="replace")  # cp1252 consoles on Windows
    except (AttributeError, ValueError):
        pass

    root = Path(args.root).expanduser().resolve()
    if not root.is_dir():
        ap.error(f"Not a directory: {root}")
    if not (1000 <= args.max_chars <= 300_000):
        ap.error("--max-chars must be between 1000 and 300000")
    if not (1 <= args.max_files <= 100):
        ap.error("--max-files must be between 1 and 100")
    if not (1 <= args.max_spans <= 50):
        ap.error("--max-spans must be between 1 and 50")
    if not (0 <= args.context_lines <= 30):
        ap.error("--context-lines must be between 0 and 30")
    if not (1 <= args.max_candidates <= 200_000):
        ap.error("--max-candidates must be between 1 and 200000")
    if not (1_000 <= args.max_file_bytes <= 500_000_000):
        ap.error("--max-file-bytes must be between 1000 and 500000000")
    terms = tokenize(args.query)
    if not terms:
        ap.error("Query must contain searchable words")

    stats = Stats()
    ranked, idf = search(root, terms, args, stats)

    notes = []
    if stats.limit_hit:
        notes.append(
            f"stopped after {args.max_candidates} files (raise --max-candidates or narrow --root)"
        )
    if stats.too_big:
        shown_big = ", ".join(stats.too_big[:3]) + (
            " …" if len(stats.too_big) > 3 else ""
        )
        notes.append(
            f"{len(stats.too_big)} file(s) over --max-file-bytes skipped: {shown_big}"
        )
    if stats.binary or stats.unreadable:
        notes.append(f"{stats.binary} binary / {stats.unreadable} unreadable skipped")
    weights = ", ".join(
        f"{t}={idf[t]:.1f}" for t in sorted(terms, key=lambda t: -idf[t])
    )
    query = args.query if len(args.query) <= 200 else args.query[:200] + "…"
    header = (
        f"# Query: {query}\n"
        f"# Terms (rarer = heavier): {weights}\n"
        f"# Root: {root}\n"
        f"# Scanned {stats.scanned} text files; {len(ranked)} match."
        + (f" Note: {'; '.join(notes)}." if notes else "")
        + "\n"
        "# Extractive context only. Omitted lines/files MUST NOT be treated as absent.\n"
    )
    out = [header]
    used = len(header)
    shown = set()

    if not args.files_only:
        budget = args.max_chars - min(RESERVE_FOR_INDEX, args.max_chars // 5)
        for _, rp, total, line_scores, _, encoding in ranked[: args.max_files]:
            block = None
            # Shrink a file that does not fit (fewer spans, then less context)
            # instead of stopping: later, smaller files may still fit.
            for spans, ctx in (
                (args.max_spans, args.context_lines),
                (2, args.context_lines),
                (1, min(1, args.context_lines)),
            ):
                try:
                    candidate = render_file(
                        root, rp, total, line_scores, encoding, ctx, spans
                    )
                except (OSError, UnicodeError):
                    break  # file vanished or became unreadable since the first pass
                if used + len(candidate) <= budget:
                    block = candidate
                    break
            if block is None:
                continue
            out.append(block)
            used += len(block)
            shown.add(rp)

    rest = [r for r in ranked if r[1] not in shown]
    if rest:
        title = (
            "\n## Matching files"
            + (" (ranked)" if args.files_only else " not shown above (ranked)")
            + "\n"
        )
        lines = [title]
        size = len(title)
        for _, rp, _, line_scores, covered, _ in rest:
            top = sorted(line_scores, key=lambda i: (-line_scores[i], i))[:5]
            hits = ",".join(str(i + 1) for i in sorted(top)) or "path only"
            row = f"- {rp} — {covered}/{len(terms)} terms, {len(line_scores)} hits, lines {hits}\n"
            if used + size + len(row) > args.max_chars - 40:
                lines.append(f"- … {len(rest) - (len(lines) - 1)} more\n")
                break
            lines.append(row)
            size += len(row)
        out.extend(lines)
    if not ranked:
        out.append(
            "\nNo matches. Try identifiers or synonyms, fewer words, --include, or a different --root.\n"
        )
    sys.stdout.write("".join(out))


if __name__ == "__main__":
    main()
