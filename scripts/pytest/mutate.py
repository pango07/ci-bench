"""Mutation check: puts a raise into a function some recorded test executed.

    mutate.py <ledger.json> <seed> <project dir>

Picks, deterministically from the seed, a source module of the workspace
(not a test file, not a conftest) and a function the recording saw a test
file execute, and inserts `raise RuntimeError("quod mutation")` as the
first statement of its body (after a docstring). Prints "<file>:<line> <name>".
"""
import ast
import json
import os
import sys

ledger, seed, proj = sys.argv[1], int(sys.argv[2]), sys.argv[3]
L = json.load(open(ledger))
cands = set()
for f, r in sorted(L.get("files", {}).items()):
    for p, fns in (r.get("exec") or {}).items():
        b = os.path.basename(p)
        if b.startswith("test_") or b.endswith("_test.py") or b == "conftest.py" or "/tests/" in "/" + p or p.startswith("tests/") or p.startswith("test/"):
            continue
        for line, name in fns:
            if not name.startswith("<"):
                cands.add((p, line, name))
cands = sorted(cands)
if not cands:
    print("no executed source function recorded", file=sys.stderr)
    sys.exit(0)
for k in range(len(cands)):
    p, line, name = cands[(seed * 7919 + k * 104729) % len(cands)]
    path = os.path.join(proj, p)
    try:
        src = open(path).read()
        tree = ast.parse(src)
    except Exception:
        continue
    hit = None
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            first = min([d.lineno for d in node.decorator_list] + [node.lineno])
            if first == line:
                hit = node
                break
    if hit is None:
        continue
    body = hit.body
    k0 = 1 if (len(body) > 1 and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant) and isinstance(body[0].value.value, str)) else 0
    stmt = body[k0]
    if stmt.lineno == hit.lineno or (k0 == 0 and len(body) == 1 and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant)):
        continue
    lines = src.splitlines(True)
    indent = " " * stmt.col_offset
    lines.insert(stmt.lineno - 1, indent + 'raise RuntimeError("quod mutation")\n')
    new = "".join(lines)
    try:
        compile(new, path, "exec")
    except SyntaxError:
        continue
    open(path, "w").write(new)
    print("%s:%d %s" % (p, line, name))
    sys.exit(0)
print("no mutable target among %d candidates" % len(cands), file=sys.stderr)
