# ci-bench

Benchmarks of CI test-suite time on real open-source projects, run on
GitHub-hosted runners.

## Method

For a pinned commit of a project, the workflow takes the N first-parent
commits that end there (20 by default), oldest first, and on one runner, per
commit:

1. checks the commit out, reinstalling dependencies only when the lockfile
   changed (not timed, the same for both series);
2. runs the project's unit tests with plain `vitest` (warm dependency
   install, the baseline);
3. runs the same tests with the same arguments under an accelerated runner;
4. alternates which of the two goes first, commit by commit.

The window's parent is a warm-up run and is not counted.

**Correctness.** Each run writes vitest's JSON report. For every commit the
two reports are compared file by file and test by test. A difference in a
file the accelerated runner did not execute counts as a wrong result and
fails the job. On some commits a mutation check also runs: a `throw` is put
into a function that a test exercised, and the accelerated run has to report
the same failures as plain vitest.

Each run writes a table to the job summary (per-commit times, speedup, files
run, and the correctness comparison). The raw results are uploaded as an
artifact.

## Running it

Actions → **bench-vitest** → Run workflow, or:

```sh
gh workflow run bench-vitest.yml -R pango07/ci-bench \
  -f repo=vuejs/core -f sha=<commit> -f commits=20 -f mode=bench
```

| input | meaning |
|---|---|
| `bin` | the runner binary, a release tag of this repo (`latest` by default) |
| `mode` | `bench` (inline), `shadow` (the critical path against plain, with the recording job as its own column) or `profile` |
| `repo`, `sha`, `commits` | the project, the last commit of the window, and how many commits |
| `vitest_args` | the project's vitest arguments |
| `lag` | shadow mode only: how many recordings are still running when the next commit starts |
| `node` | the Node.js version |
| `observe`, `mutate` | the one-time observed run (`1`/`0`) and the commits that get a mutation check |

The project needs a pnpm lockfile and vitest.
