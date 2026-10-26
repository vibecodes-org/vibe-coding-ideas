// Run: cd terminal/test && node --test launch-prompt.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { withoutFolderRecordStep } from "../shared/launch-prompt.mjs";

const NORMAL = [
  "Set up VibeCodes and pick up board work.",
  "",
  "1. Connect the board tools.",
  "2. Re-confirm the folder (never `/` or home — cd in first): call record_project_path (idea_id X, machine `hostname`, `pwd`) so future launches reopen here.",
  "3. You should already be in /a/b.",
  "4. Find work, but ASK first.",
].join("\n");

test("removes the step and renumbers the rest with no gap", () => {
  const out = withoutFolderRecordStep(NORMAL);
  assert.equal(
    out,
    [
      "Set up VibeCodes and pick up board work.",
      "",
      "1. Connect the board tools.",
      "2. You should already be in /a/b.",
      "3. Find work, but ASK first.",
    ].join("\n"),
  );
});

test("handles the packed (semicolon) form and a last-position step", () => {
  const p = "H\n\n1. A.\n2. Re-confirm the folder (never `/` or home; cd in first): call record_project_path (idea_id X) so future launches reopen here.";
  assert.equal(withoutFolderRecordStep(p), "H\n\n1. A.");
});

test("a prompt without the step is returned unchanged", () => {
  const p = "H\n\n1. A.\n2. B.";
  assert.equal(withoutFolderRecordStep(p), p);
  assert.equal(withoutFolderRecordStep(""), "");
});

test("text that merely mentions record_project_path is left alone", () => {
  const p = "1. A.\n2. Note about record_project_path in prose.";
  assert.equal(withoutFolderRecordStep(p), p);
});

test("a numbered line far from the sequence is not renumbered", () => {
  const p = "1. A.\n2. Re-confirm the folder (never `/`): call record_project_path (x).\n3. B.\n\n9. unrelated";
  assert.equal(withoutFolderRecordStep(p), "1. A.\n2. B.\n\n9. unrelated");
});
