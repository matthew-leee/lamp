/*
  Unit tests for lib/not-found-data.ts (D1, review finding: a 404 must never
  become a 500). The loader is fail-soft by contract: content from the
  database when everything resolves, the generic brand-free fallback on ANY
  failure. All fetches are injected; no network.
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import { fallbackData, loadNotFoundData } from "../lib/not-found-data.ts";

const API = "http://api.test";

/** A JSON Response stub. */
const json = (body, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

/** Fetch stub dispatching by path. */
const fetchOf = (routes) => (url) => {
  const path = new URL(url).pathname;
  const handler = routes[path];
  if (handler === undefined) {
    return Promise.reject(new Error(`unexpected path ${path}`));
  }
  return handler();
};

test("success path: company copy rendered with the resolved brand", async () => {
  const saved = process.env.NEXT_PUBLIC_API_URL;
  process.env.NEXT_PUBLIC_API_URL = API;
  try {
    const data = await loadNotFoundData(
      fetchOf({
        "/api/site-content": () =>
          json({
            content: {
              "notFound.title": {
                en: "{brand} | Page not found / 找不到頁面",
                "zh-HK": "{brand} | Page not found / 找不到頁面",
              },
              "notFound.description": {
                en: "Page not found. {brand}, curated designer homeware, Hong Kong.",
                "zh-HK": "Page not found. {brand}, curated designer homeware, Hong Kong.",
              },
              "notFound.body": {
                en: "This page does not exist. The two language editions of {brand} are linked below.",
                "zh-HK": "此頁面不存在。以下連結前往 {brand} 兩個語言版本。",
              },
            },
          }),
        "/api/settings": () => json({ "brand.name": "HVILE" }),
      }),
    );
    assert.equal(data.title.en, "HVILE | Page not found / 找不到頁面");
    assert.equal(
      data.body.en,
      "This page does not exist. The two language editions of HVILE are linked below.",
    );
    assert.equal(data.body["zh-HK"], "此頁面不存在。以下連結前往 HVILE 兩個語言版本。");
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = saved;
  }
});

test("missing API URL degrades to the generic fallback (not a throw)", async () => {
  const saved = process.env.NEXT_PUBLIC_API_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
  try {
    const data = await loadNotFoundData(fetchOf({}));
    const expected = fallbackData();
    assert.equal(data.title.en, expected.title.en);
    assert.equal(data.body.en, "This page does not exist. The two language editions are linked below.");
  } finally {
    if (saved !== undefined) process.env.NEXT_PUBLIC_API_URL = saved;
  }
});

test("API outage degrades to the generic fallback (not a throw)", async () => {
  const saved = process.env.NEXT_PUBLIC_API_URL;
  process.env.NEXT_PUBLIC_API_URL = API;
  try {
    const data = await loadNotFoundData(
      fetchOf({
        "/api/site-content": () => json({ error: "database not configured: set DATABASE_URL" }, 503),
        "/api/settings": () => json({}, 503),
      }),
    );
    assert.equal(data.title.en, "Page not found / 找不到頁面");
    assert.equal(
      data.body["zh-HK"],
      "此頁面不存在。以下連結前往兩個語言版本。",
    );
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = saved;
  }
});

test("missing notFound keys degrade to the generic fallback", async () => {
  const saved = process.env.NEXT_PUBLIC_API_URL;
  process.env.NEXT_PUBLIC_API_URL = API;
  try {
    const data = await loadNotFoundData(
      fetchOf({
        // Site content exists but has no notFound.* keys at all.
        "/api/site-content": () => json({ content: { "hero.eyebrow": { en: "x" } } }),
        "/api/settings": () => json({ "brand.name": "HVILE" }),
      }),
    );
    const expected = fallbackData();
    assert.equal(data.body.en, expected.body.en);
    assert.equal(data.title.en, expected.title.en);
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = saved;
  }
});