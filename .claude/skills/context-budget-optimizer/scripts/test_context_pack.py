#!/usr/bin/env python3
"""Self-test for context_pack.py (stdlib only): python3 scripts/test_context_pack.py"""

import os
import string
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().with_name("context_pack.py")


def fake(prefix: str, n: int) -> str:
    """Build a token-shaped test value at runtime, so no literal key sits in this file."""
    alphabet = string.ascii_lowercase + string.digits
    return prefix + "".join(alphabet[i % len(alphabet)] for i in range(n))


def run(root, *args, env=None):
    # -I (isolated) would also ignore PYTHONIOENCODING, which the console test needs.
    flags = ["-s"] if env else ["-I"]
    res = subprocess.run(
        [sys.executable, *flags, str(SCRIPT), "--root", str(root), *args],
        capture_output=True,
        timeout=60,
        env=env,
        check=False,
    )
    assert res.returncode == 0, res.stderr.decode("utf-8", "replace")
    return res.stdout.decode("utf-8", "replace")


class ContextPackTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rel, text, encoding="utf-8"):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding=encoding)
        return p

    def test_redacts_prefixed_keys_json_and_token_formats(self):
        secrets = [
            fake("sk" + "-proj-", 32),
            fake("AI" + "za", 35),
            fake("xai" + "-", 20),
            fake("gh" + "p_", 36),
            "hunter2hunter2",
            "plainsecretvalue",
            "p4ssw0rdInUrl",
        ]
        self.write(
            "cfg.js",
            "\n".join(
                [
                    f'const OPENAI_API_KEY = "{secrets[0]}";',
                    f'const cfg = {{ "api_key": "{secrets[1]}", "xaiApiKey": "{secrets[2]}" }};',
                    f"export GITHUB_TOKEN={secrets[3]}",
                    f"password: {secrets[4]}",
                    f"DB_PASSWORD={secrets[5]}",
                    f'const url = "postgres://app:{secrets[6]}@db:5432/x";',
                    "const password = req.body.password;",
                ]
            ),
        )
        out = run(self.root, "--query", "api key token password url")
        for s in secrets:
            self.assertNotIn(s, out)
        self.assertIn("req.body.password", out)  # code references stay readable

    def test_redacts_dotted_values_in_config_files(self):
        secret = "Sup3r.Secret1"
        self.write("app.properties", f"db.password={secret}\n")
        self.write("config.yaml", f"password: {secret}\n")
        self.write(".env.example", f"DB_PASSWORD={secret}\n")
        out = run(self.root, "--query", "password")
        self.assertIn("app.properties", out)
        self.assertNotIn(secret, out)

    def test_redacts_xml_elements(self):
        secret = "Xq9Lm2Vt8Rz4"
        self.write("settings.xml", f"<server>\n  <password>{secret}</password>\n  <apiKey>{secret}</apiKey>\n</server>\n")
        out = run(self.root, "--query", "password server")
        self.assertIn("settings.xml", out)
        self.assertNotIn(secret, out)
        self.assertIn("<password><REDACTED></password>", out)

    def test_does_not_over_redact(self):
        self.write(
            "package.json",
            '{\n  "author": "Andrei Stoica",\n  "tokenizer": "cl100k_base",\n'
            '  "maxTokens": 1000000,\n  "passwordPolicy": "strict-mode"\n}\n',
        )
        out = run(self.root, "--query", "author tokenizer maxtokens passwordpolicy")
        for kept in ("Andrei Stoica", "cl100k_base", "1000000", "strict-mode"):
            self.assertIn(kept, out)

    def test_private_key_block_hidden(self):
        body = fake("MIIE", 40)
        self.write(
            "sa.txt",
            "deploy key\n-----BEGIN PRIVATE KEY-----\n"
            + body
            + "\n-----END PRIVATE KEY-----\n",
        )
        out = run(self.root, "--query", "deploy key")
        self.assertNotIn(body, out)

    def test_env_and_lockfiles_skipped_but_github_dir_searched(self):
        self.write(".env", "WIDGET=1\n")
        self.write(".env.sample", "WIDGET=2\n")
        self.write("package-lock.json", '{"widget": 1}\n')
        self.write(".github/workflows/ci.yml", "name: widget build\n")
        out = run(self.root, "--query", "widget")
        self.assertIn(".github/workflows/ci.yml", out)
        self.assertIn(".env.sample", out)
        self.assertNotIn("package-lock.json", out)
        self.assertNotIn("## .env (", out)

    def test_include_matches_relative_paths(self):
        self.write("apps/server/a.js", "widget\n")
        self.write("apps/desktop/b.js", "widget\n")
        out = run(self.root, "--query", "widget", "--include", "apps/server/*")
        self.assertIn("apps/server/a.js", out)
        self.assertNotIn("apps/desktop/b.js", out)

    def test_large_log_is_searched(self):
        lines = (
            f"{i} ok" if i != 123_456 else f"{i} FATAL connection reset"
            for i in range(200_000)
        )
        self.write("server.log", "\n".join(lines) + "\n")
        out = run(self.root, "--query", "fatal")
        self.assertIn("123457:", out)

    def test_utf16_powershell_log_is_searched(self):
        self.write("ps.log", "start\r\nERROR disk full\r\n", encoding="utf-16")
        out = run(self.root, "--query", "disk full")
        self.assertIn("ps.log", out)
        self.assertIn("ERROR disk full", out)

    def test_windows_console_encoding_does_not_crash(self):
        self.write("ro.md", "Configurația pentru fișier — „widget” …\n")
        env = dict(os.environ, PYTHONIOENCODING="cp1252")
        out = run(self.root, "--query", "widget", env=env)
        self.assertIn("ro.md", out)

    def test_rare_term_beats_stopwords_and_common_term(self):
        for i in range(20):
            self.write(f"noise{i}.js", "the model is used for the request\n" * 5)
        self.write(
            "target.js",
            "function chooseFallback(model) {\n  return directFallbackAllowed;\n}\n",
        )
        out = run(
            self.root,
            "--query",
            "how does the fallback work for the model",
            "--files-only",
        )
        first = next(line for line in out.splitlines() if line.startswith("- "))
        self.assertIn("target.js", first)

    def test_budget_lists_remaining_files_and_respects_limit(self):
        for i in range(15):
            self.write(f"m{i:02d}.py", "".join(f"alpha line {j}\n" for j in range(80)))
        out = run(self.root, "--query", "alpha", "--max-chars", "2000")
        self.assertLessEqual(len(out), 2000)
        self.assertIn("not shown above", out)

    def test_long_lines_clipped(self):
        self.write("bundle.js", "var needle=1;" + "x" * 50_000 + "\n")
        out = run(self.root, "--query", "needle")
        self.assertIn("chars total]", out)
        self.assertLess(len(out), 3000)

    def test_no_match_message(self):
        self.write("a.py", "print(1)\n")
        self.assertIn("No matches", run(self.root, "--query", "zebra"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
