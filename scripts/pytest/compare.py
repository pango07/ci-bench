"""Compares two pytest JUnit XML reports test by test.

    compare.py <plain.xml> <other.xml> <other's quod summary.json>

A test whose outcome differs (or that one report lacks) counts as WRONG when
it belongs to a file the other run replayed, and as flaky when its file ran
there (both runs executed it). Prints the details, then one JSON line:
{"files", "tests", "wrong": [...], "flaky": [...], "plain_failed", "crit_failed"}.
"""
import json
import re
import sys
import xml.etree.ElementTree as ET


def outcomes(path):
    out = {}
    root = ET.parse(path).getroot()
    for tc in root.iter("testcase"):
        key = "%s::%s" % (tc.get("classname", ""), tc.get("name", ""))
        o = "passed"
        for child in tc:
            if child.tag in ("failure", "error"):
                o = child.tag
                break
            if child.tag == "skipped":
                t = child.get("type", "")
                o = "xfailed" if "xfail" in t else "skipped:" + re.sub(r"0x[0-9a-fA-F]{4,}", "0x?", child.get("message", ""))
                break
        if key in out:
            key = key + "#%d" % sum(1 for k in out if k.startswith(key))
        out[key] = o
    return out


def main():
    a, b, sp = sys.argv[1:4]
    try:
        pa = outcomes(a)
        pb = outcomes(b)
    except Exception as e:
        print(json.dumps({"error": "unreadable report: %s" % e}))
        return
    try:
        s = json.load(open(sp))
    except Exception:
        s = {}
    ran = set(s.get("run_files") or [])
    mods = sorted(((f[:-3] if f.endswith(".py") else f).replace("/", "."), f) for f in ran)

    def ran_here(key):
        cls = key.split("::", 1)[0]
        for m, _ in mods:
            if cls == m or cls.startswith(m + "."):
                return True
        return False

    wrong, flaky = [], []
    for k in sorted(set(pa) | set(pb)):
        x, y = pa.get(k), pb.get(k)
        if x == y:
            continue
        line = "%s: plain %s, other %s" % (k, x, y)
        if ran_here(k) and x is not None and y is not None:
            flaky.append(line)
        else:
            wrong.append(line)
    for l in wrong:
        print("WRONG " + l)
    for l in flaky:
        print("flaky " + l)
    nf = lambda p: sum(1 for v in p.values() if v in ("failure", "error"))
    print(json.dumps({"files": len(ran), "tests": len(pa), "wrong": wrong[:20] if wrong else [], "nwrong": len(wrong),
                      "flaky": flaky[:20], "plain_failed": nf(pa), "crit_failed": nf(pb)}))


main()
