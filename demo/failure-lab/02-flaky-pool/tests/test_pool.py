import random
import time
import unittest

from pool import Pool


def slow_square(x):
    # Real tasks take a variable amount of time.
    time.sleep(random.uniform(0, 0.03))
    return x * x


class PoolTest(unittest.TestCase):
    def test_close_returns_every_result(self):
        p = Pool(workers=4)
        for i in range(8):
            p.submit(slow_square, i)
        self.assertEqual(p.close(), [i * i for i in range(8)])


if __name__ == "__main__":
    unittest.main()
