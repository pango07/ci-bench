"""One results.jsonl row for a commit of the pytest shadow bench."""
import json
import sys

(i, c, subject, touched, areas, p_ms, p_rc, q_ms, q_rc, sh_ms, sh_rc, frm, install_ms, nbytes, cmp, scmp, cs, ss) = sys.argv[1:19]


def j(p):
    try:
        return json.load(open(p))
    except Exception:
        return {}


def k(t):
    try:
        return json.loads(t)
    except Exception:
        return {"error": t}


s, h, a, b = j(cs), j(ss), k(cmp), k(scmp)
sh = h.get("shadow") or {}
print(json.dumps({
    "i": int(i), "first": i == "0", "commit": c, "subject": subject, "touched": int(touched), "areas": areas,
    "plain_ms": int(p_ms), "plain_exit": int(p_rc), "crit_ms": int(q_ms), "crit_exit": int(q_rc),
    "ledger_from": int(frm), "shadow_ms": int(sh_ms), "shadow_exit": int(sh_rc), "install_ms": int(install_ms), "ledger_bytes": int(nbytes),
    "ran": s.get("ran"), "replayed": s.get("replayed"), "replayed_tests": s.get("replayed_tests"), "collected_only": len(s.get("collected_only") or []),
    "narrowed": len(s.get("narrowed") or []), "select_ms": s.get("select_ms"), "tripped": s.get("tripped"),
    "pre_ms": s.get("pre_ms"), "setup_ms": s.get("setup_ms"), "post_ms": s.get("post_ms"), "pytest_ms": s.get("pytest_ms"),
    "guard_ms": s.get("guard_ms"), "guard_fps": s.get("guard_fps"), "shadow_guard_ms": h.get("guard_ms"),
    "reasons": dict(list((s.get("reasons") or {}).items())[:12]), "session_changed": s.get("session_changed"),
    "shadow_ran": h.get("ran"), "recorded": sh.get("recorded"), "certified": sh.get("certified"), "uncertified": sh.get("uncertified"),
    "quarantined": sh.get("quarantined"), "unrecordable": sh.get("unrecordable"), "audit_mismatches": sh.get("audit_mismatches"),
    "not_recorded": sh.get("not_recorded"), "record_ms": sh.get("record_ms"), "certify_ms": sh.get("certify_ms"), "shadow_error": sh.get("error"),
    "files": a.get("files"), "tests": a.get("tests"), "wrong": a.get("wrong") if "error" not in a else None, "flaky": a.get("flaky"),
    "compare_error": a.get("error"), "shadow_wrong": b.get("wrong"), "shadow_flaky": b.get("flaky"),
}))
