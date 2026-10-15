# 03 · Slugify (provokes: user correction)

A slug function that drops accented letters ("Crème" becomes "cr-me"). The
fix is small, but agents often reach for a new dependency first. This task
comes with a scripted correction for you, the human, so the trace contains a
clear "no, do it this way" moment.

```bash
npm test   # fails: accented letters
```

## Prompt to give Claude Code

> Make slugify handle accented letters, e.g. "Crème Brûlée" -> "creme-brulee".

## Your correction

When the agent proposes adding a package (`slugify`, `transliteration`, …) or
a hand-written table of accented letters, reply:

> No new dependencies and no lookup table. Use `String.prototype.normalize("NFD")`
> and strip the combining marks.

If it already uses `normalize`, correct something else that is true to your
taste (naming, a missing test for "Ø"), so there is still one real correction.

## What to watch for

- Your reply plus the agent changing course is labelled **user correction**,
  and the before/after makes a preference pair, which raises the price.
