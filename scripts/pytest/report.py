"""The job-summary table of the pytest shadow bench (results.jsonl -> markdown)."""
import json
import statistics
import sys

path, args, origin, lag, audits = sys.argv[1:6]
rows = [json.loads(l) for l in open(path) if l.strip()]
commits = [r for r in rows if not r.get("mutation")]
muts = [r for r in rows if r.get("mutation")]
win = [r for r in commits if not r["first"]]
s = lambda ms: "%.2f" % (ms / 1000)
print("### pytest, shadow mode: %s `%s`" % (origin, args))
print()
print("Critical path = `quod pytest --no-record` (the developer's job); shadow = the recording job (its own column, off the critical path). Lag %s, shadow audits %s." % (lag, audits))
print()
if win:
    pt = sum(r["plain_ms"] for r in win)
    qt = sum(r["crit_ms"] for r in win)
    sp = [r["plain_ms"] / max(r["crit_ms"], 1) for r in win]
    shc = sum(r["shadow_ms"] for r in win)
    nw = sum(len(r["wrong"]) if isinstance(r.get("wrong"), list) else 1 for r in win)
    ran = sum(r.get("ran") or 0 for r in win)
    rep = sum(r.get("replayed") or 0 for r in win)
    print("| commits | plain total | critical path total | speedup total | speedup median | shadow compute | files run / replayed | narrowed | guard trips | wrong | mutations |")
    print("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|")
    mok = sum(1 for m in muts if m.get("wrong") == [] and m.get("crit_failed") == m.get("plain_failed"))
    print("| %d | %s s | %s s | %.2fx | %.2fx | %s s | %d / %d | %d | %d | %d | %d/%d ok |" % (
        len(win), s(pt), s(qt), pt / max(qt, 1), statistics.median(sp), s(shc), ran, rep,
        sum(r.get("narrowed") or 0 for r in win), sum(1 for r in win if r.get("tripped")), nw, mok, len(muts)))
    print()
print("| # | commit | subject | touched | plain s | critical s | speedup | shadow s | ran | replayed | narrowed | certified | uncertified | quarantined | unrecordable | guard | wrong | flaky |")
print("|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|")
for r in commits:
    subj = (r["subject"] or "")[:48].replace("|", "/")
    w = r.get("wrong")
    print("| %d | `%s` | %s | %d | %s | %s | %.2fx | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % (
        r["i"], r["commit"][:9], subj, r["touched"], s(r["plain_ms"]), s(r["crit_ms"]), r["plain_ms"] / max(r["crit_ms"], 1), s(r["shadow_ms"]),
        r.get("ran"), r.get("replayed"), r.get("narrowed"), r.get("certified"), len(r.get("uncertified") or []), len(r.get("quarantined") or []),
        len(r.get("unrecordable") or {}), "trip" if r.get("tripped") else "", "n/a" if w is None else len(w), len(r.get("flaky") or [])))
print()
if muts:
    print("Mutation checks (a raise in a function a recorded test executed):")
    print()
    print("| # | target | plain failed | critical failed | ran | replayed | wrong |")
    print("|---:|---|---:|---:|---:|---:|---:|")
    for m in muts:
        print("| %d | `%s` | %s | %s | %s | %s | %s |" % (m["i"], m["target"], m.get("plain_failed"), m.get("crit_failed"), m.get("ran"), m.get("replayed"),
                                             "n/a" if m.get("wrong") is None else len(m["wrong"])))
    print()
notes = []
for r in commits:
    for f, why in (r.get("unrecordable") or {}).items():
        notes.append("commit %d: %s unrecordable: %s" % (r["i"], f, why))
    for f in r.get("quarantined") or []:
        notes.append("commit %d: %s quarantined" % (r["i"], f))
    for f in r.get("uncertified") or []:
        notes.append("commit %d: %s not certified (alone != in session)" % (r["i"], f))
    if r.get("tripped"):
        notes.append("commit %d: guard: %s" % (r["i"], r["tripped"]))
    if r.get("shadow_error"):
        notes.append("commit %d: shadow: %s" % (r["i"], r["shadow_error"]))
if notes:
    print("<details><summary>notes (%d)</summary>\n" % len(notes))
    for n in notes[:200]:
        print("- " + n.replace("|", "/"))
    print("\n</details>")
