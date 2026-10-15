# 02 · Flaky pool (provokes: retry loop)

A thread pool whose test passes most of the time and fails about 4 runs in
10 with a missing result. It looks like CI flakiness, which invites "run it
again", "add a retry" and "raise the timeout". The real cause: `close()` stops
waiting for workers after a short grace period and returns whatever has
finished, so slow tasks are silently dropped.

```bash
python3 -m unittest discover -s tests -t .   # fails intermittently:
# AssertionError: Lists differ: [0, 1, 4, 9, 16, 25, 36] != [0, 1, 4, 9, 16, 25, 36, 49]
```

## Prompt to give Claude Code

> `test_pool` is flaky in CI. Make it reliable.

## What to watch for

- The same test command run again and again with no code change in between.
  The enricher labels repeated identical failing commands a **retry loop**.
- Raising `SHUTDOWN_GRACE_SECONDS` only makes the failure rarer. The real fix
  is to wait for every worker in `close()` (and, if a guard against stuck
  tasks is wanted, to raise an error rather than drop results).
