/*
  Unit tests for lib/i18n.ts (LOCALE-01): the locale pair is env-configured,
  parsed and validated at load. The module resolves at import time, so each
  scenario imports a fresh copy via a distinct URL (module cache busting).
*/

import { test } from "node:test";
import assert from "node:assert/strict";

const MODULE = new URL("../lib/i18n.ts", import.meta.url);

/** Import a fresh copy of the module with NEXT_PUBLIC_LOCALES set to `value`. */
async function importWithLocales(value) {
  const saved = process.env.NEXT_PUBLIC_LOCALES;
  if (value === undefined) delete process.env.NEXT_PUBLIC_LOCALES;
  else process.env.NEXT_PUBLIC_LOCALES = value;
  try {
    return await import(`${MODULE.href}?v=${encodeURIComponent(String(value))}`);
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_LOCALES;
    else process.env.NEXT_PUBLIC_LOCALES = saved;
  }
}

test("default locale pair is en,zh-HK with correct language tags", async () => {
  const i18n = await importWithLocales(undefined);
  assert.deepEqual([...i18n.locales], ["en", "zh-HK"]);
  assert.equal(i18n.htmlLang.en, "en");
  assert.equal(i18n.htmlLang["zh-HK"], "zh-Hant-HK");
  assert.equal(i18n.defaultLocale, "en");
  assert.equal(i18n.altLocale("en"), "zh-HK");
  assert.equal(i18n.altLocale("zh-HK"), "en");
  assert.equal(i18n.languageNames.en, "English");
  assert.equal(i18n.languageNames["zh-HK"], "繁體中文");
  assert.ok(i18n.isLocale("en"));
  assert.ok(!i18n.isLocale("fr"));
});

test("a different configured pair drives routing metadata", async () => {
  const i18n = await importWithLocales("fr,zh-HK");
  assert.deepEqual([...i18n.locales], ["fr", "zh-HK"]);
  assert.equal(i18n.defaultLocale, "fr"); // first is the default
  assert.equal(i18n.htmlLang.fr, "fr"); // identity fallback for unknown tags
  assert.equal(i18n.htmlLang["zh-HK"], "zh-Hant-HK"); // built-in precision kept
  assert.equal(i18n.altLocale("fr"), "zh-HK");
});

test("exactly two locales: one, three, duplicate and bad tags fail loudly", async () => {
  for (const value of ["en", "en,zh-HK,fr", "en,en", "en,zh HK", "not_a_tag,zh-HK", ", ,, "]) {
    await assert.rejects(
      () => importWithLocales(value),
      /parseLocales:/,
      `expected "${value}" to be rejected`,
    );
  }
});
