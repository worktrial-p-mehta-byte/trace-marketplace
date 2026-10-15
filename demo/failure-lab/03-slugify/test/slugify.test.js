import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slugify.js";

test("ascii titles", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
});

test("accented letters keep their base letter", () => {
  assert.equal(slugify("Crème Brûlée"), "creme-brulee");
  assert.equal(slugify("Ångström über naïve"), "angstrom-uber-naive");
});
