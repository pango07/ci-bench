# Original cold window with optional managed Vitest

The managed experiment reuses the original twelve first-parent commits in
`scripts/job/managed-window.json`, with no repeated warm-up commit. The install,
build and test commands remain `npm ci`, `npm run build` and `npm run test`.
The original ordinary/floor job definitions are unchanged.

The four default variants are `floor`, `plain`, `managed-control` and `managed`.
The two managed variants use the same shipped Action and dependency caching.
Each has an independent cache namespace, unique to its coordinator run, so both
start cold and later commits can use only their own chain's saved dependencies.
Control always executes managed tests without receipt reuse; managed may reuse
the closed expensive file. The other Vitest files and npm's release-test tail
continue to execute. Candidate reuse is not a full-job hit.

Before dispatch, replace the `MANAGED_ACTION_SHA` placeholder in
`.github/workflows/bench-job-one.yml` with the full remotely built Action commit.
The coordinator rejects an unresolved placeholder, another commit window,
a warm-up commit, a missing ordinary/control variant or Cloud writes.

```sh
gh workflow run bench-job.yml -R pango07/ci-bench --ref bench/managed-vitest-sol-ultra \
  -f only=convex-helpers -f commits=12 \
  -f variants=floor,plain,managed-control,managed -f warm_first=false -f cloud=false
```

There is one fresh GitHub job per commit and variant. Managed chains wait for
their predecessor before dispatching the next commit. The independent chains
run concurrently. Queue time is excluded from runner time; setup, Action
installation, cache restore/save, compilation, validation, work, post steps and
diagnostic artifact uploads remain in complete Jobs API runner duration.

Every non-floor job retains the complete Vitest report fingerprint. There are
120 file/project instances throughout the window, with 4,129 tests at c0–c6,
4,130 at c7 and 4,131 at c8–c11. c2 onward also retain the node:test release tail;
its independent test/pass/fail/skip counts must agree with plain. Managed
candidate effects must agree with the independent managed control of the same
commit/native class. Default reporter display summaries may differ after the
candidate split; they remain raw evidence and cannot substitute for complete
test-name/state comparison.

`job-metrics.json` records complete-window and c1–c11 runner seconds, the sum of
per-job rounded minutes, candidate reuse/execution/fallback counts and pinned
source provenance. It compares managed against fresh ordinary, uncached
managed and the prior ordinary 1,735 runner-seconds / 36 modeled minutes.
Time and modeled cost remain separate. Public GitHub runners incur no actual
runner charge for this repository.
