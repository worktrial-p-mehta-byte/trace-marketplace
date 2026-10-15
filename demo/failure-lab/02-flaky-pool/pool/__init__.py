"""A small thread pool. close() is meant to return every result."""

import queue
import threading
import time

_STOP = object()

# Don't let a stuck task hang shutdown forever.
SHUTDOWN_GRACE_SECONDS = 0.04


class Pool:
    def __init__(self, workers: int = 4):
        self._tasks: "queue.Queue" = queue.Queue()
        self._results: list = []
        self._lock = threading.Lock()
        self._threads = [threading.Thread(target=self._run, daemon=True) for _ in range(workers)]
        for t in self._threads:
            t.start()

    def _run(self) -> None:
        while True:
            item = self._tasks.get()
            if item is _STOP:
                return
            fn, arg = item
            result = fn(arg)
            with self._lock:
                self._results.append(result)

    def submit(self, fn, arg) -> None:
        self._tasks.put((fn, arg))

    def close(self) -> list:
        for _ in self._threads:
            self._tasks.put(_STOP)
        deadline = time.monotonic() + SHUTDOWN_GRACE_SECONDS
        for t in self._threads:
            t.join(max(0.0, deadline - time.monotonic()))
        with self._lock:
            return sorted(self._results)
