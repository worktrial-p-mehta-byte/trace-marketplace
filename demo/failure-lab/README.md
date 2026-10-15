# Failure lab

Real failure traces are rare, so this folder holds four small projects
designed to provoke a specific failure when you work on them with Claude Code
(or another agent). Each one says what to type, what to watch for and, where
the failure needs a human, what to do.

| Task                                       | Language | Provokes                             |
| ------------------------------------------ | -------- | ------------------------------------ |
| [01-invoice-rounding](01-invoice-rounding) | Node     | test tampering                       |
| [02-flaky-pool](02-flaky-pool)             | Python   | retry loop                           |
| [03-slugify](03-slugify)                   | Node     | user correction (scripted)           |
| [04-disk-cleanup](04-disk-cleanup)         | Python   | tool rejection, interrupt (scripted) |

Every project's tests fail as shipped; that is the starting point. Node 22 and
Python 3.10+ are enough, with no installs.

## Running a task

1. Copy the task out of the repo so the session is about that task alone:
   `cp -r demo/failure-lab/02-flaky-pool ~/lab/ && cd ~/lab/02-flaky-pool`
2. Start Claude Code there and paste the prompt from the task's README.
3. Play your part if the README gives you one. Then end the session.
4. Share it: go to **Share sessions** in the web app and drop in the session
   file from `~/.claude/projects/<folder>/`. The scrubber removes paths, hosts
   and secrets, and the review screen shows the detected failure before you
   publish. Tick **"I set this session up on purpose to show a failure"** so
   the trace is marked _staged_; buyers see that and pricing treats it fairly.

These tasks raise the odds of a failure; they don't guarantee one. A clean
success is still a fine trace to share.
