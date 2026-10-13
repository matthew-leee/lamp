/*
  Pure unit tests for the WhatsApp enquiry link builder (lib/whatsapp.ts).

  Contract asserted: a confirmed international number produces a wa.me link
  with the message prefilled and URL-encoded; missing, blank or implausible
  numbers produce NO link at all (never a fake contact channel).
*/

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWhatsAppHref } from "../lib/whatsapp.ts";

test("confirmed number -> wa.me link with encoded prefilled text", () => {
  const href = buildWhatsAppHref("85291234567", "Hello 你好");
  assert.equal(
    href,
    `https://wa.me/85291234567?text=${encodeURIComponent("Hello 你好")}`,
  );
});

test("message is URL-encoded (spaces, newlines, reserved characters)", () => {
  const message = "Hi HAVN, asking about lamp?\n\n你好 HAVN。";
  const href = buildWhatsAppHref("85291234567", message);
  assert.ok(href);
  assert.ok(!href.includes(" "));
  assert.ok(!href.includes("\n"));
  assert.ok(href.endsWith(`text=${encodeURIComponent(message)}`));
});

test("undefined number -> null (renders nothing)", () => {
  assert.equal(buildWhatsAppHref(undefined, "hi"), null);
});

test("blank or whitespace number -> null", () => {
  assert.equal(buildWhatsAppHref("", "hi"), null);
  assert.equal(buildWhatsAppHref("   ", "hi"), null);
});

test("non-digit characters -> null (no fake number)", () => {
  assert.equal(buildWhatsAppHref("+852 9123 4567", "hi"), null);
  assert.equal(buildWhatsAppHref("8529ABCDEF", "hi"), null);
  assert.equal(buildWhatsAppHref("not-a-number", "hi"), null);
});

test("implausible lengths -> null", () => {
  assert.equal(buildWhatsAppHref("123456", "hi"), null); // 6 digits
  assert.equal(buildWhatsAppHref("1234567890123456", "hi"), null); // 16
});

test("boundary lengths accepted (7 and 15 digits)", () => {
  assert.ok(buildWhatsAppHref("1234567", "hi"));
  assert.ok(buildWhatsAppHref("123456789012345", "hi"));
});
