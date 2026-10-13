//! Runtime configuration knobs (ENV-01): every deployable scalar comes from
//! the environment with a safe default, never an inline literal. An invalid or
//! unparseable value logs a warning and falls back to the default rather than
//! failing boot.
//!
//! The parsing/clamping rules live in pure functions so they are unit-testable
//! without touching process environment (which would race across parallel
//! tests).

use std::sync::Once;

use axum::http::HeaderValue;
use tracing::warn;

/// Default allowed browser origin: the local web app during development.
pub const DEFAULT_CORS_ORIGIN: &str = "http://localhost:3000";

/// Default Postgres pool size.
pub const DEFAULT_POOL_SIZE: u32 = 5;

/// Minimum accepted `SESSION_SECRET` length in bytes. HMAC-SHA256 accepts any
/// key length, but the cookie signature is the only thing standing between a
/// forger and the admin console, so a brute-forceable short secret disables
/// sessions entirely instead of half-protecting them.
pub const MIN_SESSION_SECRET_BYTES: usize = 32;

/// Default for the admin session cookie's `Secure` flag: ON. The cookie is a
/// bearer credential; over plain HTTP any on-path observer can steal it.
pub const DEFAULT_SESSION_COOKIE_SECURE: bool = true;

// Compile-time pin (assertions on constants belong in const context): the
// session cookie's `Secure` flag defaults ON. Flipping that default OFF must
// be a deliberate, visible edit — the cookie is a bearer credential.
const _: () = assert!(DEFAULT_SESSION_COOKIE_SECURE);

/// Pool size bounds: a pool of 0 stalls every request; an unbounded pool
/// exhausts Postgres connections under load.
pub const MIN_POOL_SIZE: u32 = 1;
pub const MAX_POOL_SIZE: u32 = 64;

/// Default locale set (LOCALE-01, LOCALE-02): the supported pair. The API-side
/// mirror of the web tier's `NEXT_PUBLIC_LOCALES`, used to validate admin
/// content writes (`product_content`/`site_content`).
pub const DEFAULT_LOCALES: &[&str] = &["en", "zh-HK"];

// Warn-once guards. These knobs are read from REQUEST paths (admin write
// validation, the per-mutation webhook), unlike the boot-only knobs above:
// warn-and-fallback on every call would print a line per admin write for one
// boot-time misconfiguration. The first call (boot, see `main`) warns; later
// calls fall back silently — the fallback itself never changes.
static LOCALES_WARN: Once = Once::new();
static REVALIDATE_URL_WARN: Once = Once::new();
static REVALIDATE_SECRET_WARN: Once = Once::new();

/// Resolves `CORS_ORIGIN`, the single allowed browser origin for the API.
/// Invalid values warn and fall back to [`DEFAULT_CORS_ORIGIN`].
pub fn cors_origin() -> HeaderValue {
    match std::env::var("CORS_ORIGIN") {
        Ok(raw) => match parse_cors_origin(&raw) {
            Some(origin) => origin,
            None => {
                warn!(value = %raw, "CORS_ORIGIN is not a valid origin; using default");
                default_cors_origin()
            }
        },
        Err(_) => default_cors_origin(),
    }
}

/// Resolves `MAX_POOL_CONNECTIONS`, the Postgres pool size (default
/// [`DEFAULT_POOL_SIZE`], clamped to [`MIN_POOL_SIZE`]..=[`MAX_POOL_SIZE`]).
pub fn max_pool_connections() -> u32 {
    match std::env::var("MAX_POOL_CONNECTIONS") {
        Ok(raw) => match raw.trim().parse::<u32>() {
            Ok(requested) => {
                let size = clamp_pool_size(requested);
                if size != requested {
                    warn!(
                        requested,
                        size, "MAX_POOL_CONNECTIONS out of range; clamped"
                    );
                }
                size
            }
            Err(_) => {
                warn!(value = %raw, "MAX_POOL_CONNECTIONS is not an integer; using default");
                DEFAULT_POOL_SIZE
            }
        },
        Err(_) => DEFAULT_POOL_SIZE,
    }
}

fn default_cors_origin() -> HeaderValue {
    HeaderValue::from_static(DEFAULT_CORS_ORIGIN)
}

/// Resolves `SESSION_SECRET`, the HMAC key for admin session cookies
/// (ADMIN-01). Trimmed value must be at least [`MIN_SESSION_SECRET_BYTES`]
/// bytes; missing or weak values return `None` and warn (admin login then
/// reports 503) rather than signing cookies under a guessable key. The secret
/// value itself is never logged — only its length.
pub fn session_secret() -> Option<Vec<u8>> {
    match std::env::var("SESSION_SECRET") {
        Ok(raw) => match parse_session_secret(&raw) {
            Some(secret) => Some(secret),
            None => {
                warn!(
                    len = raw.trim().len(),
                    "SESSION_SECRET is under 32 bytes; admin sessions disabled"
                );
                None
            }
        },
        Err(_) => {
            warn!("SESSION_SECRET not set; admin sessions disabled");
            None
        }
    }
}

/// Resolves `SESSION_COOKIE_SECURE`: whether the admin session cookie carries
/// the `Secure` flag. Defaults to [`DEFAULT_SESSION_COOKIE_SECURE`] (ON);
/// `SESSION_COOKIE_SECURE=false` exists for plain-HTTP local dev. An
/// unparseable value warns and falls back to the default.
pub fn session_cookie_secure() -> bool {
    match std::env::var("SESSION_COOKIE_SECURE") {
        Ok(raw) => match parse_bool(&raw) {
            Some(value) => value,
            None => {
                warn!(value = %raw, "SESSION_COOKIE_SECURE is not a boolean; using default");
                DEFAULT_SESSION_COOKIE_SECURE
            }
        },
        Err(_) => DEFAULT_SESSION_COOKIE_SECURE,
    }
}

/// Pure parse for [`session_secret`]: trimmed, at least
/// [`MIN_SESSION_SECRET_BYTES`] bytes, returned as raw key bytes.
fn parse_session_secret(raw: &str) -> Option<Vec<u8>> {
    let raw = raw.trim();
    (raw.len() >= MIN_SESSION_SECRET_BYTES).then(|| raw.as_bytes().to_vec())
}

/// Pure parse for [`session_cookie_secure`] and future boolean knobs.
fn parse_bool(raw: &str) -> Option<bool> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Some(true),
        "false" | "0" | "no" | "off" => Some(false),
        _ => None,
    }
}

/// Pure parse for [`cors_origin`]: after trimming, the value must be non-empty,
/// contain no whitespace and look like an absolute origin
/// (`scheme://host[:port]`), and be a legal HTTP header value.
fn parse_cors_origin(raw: &str) -> Option<HeaderValue> {
    let raw = raw.trim();
    if raw.is_empty() || raw.contains(char::is_whitespace) {
        return None;
    }
    // Origin only: `scheme://host[:port]`. A value carrying a path, query or
    // fragment (e.g. `https://shop.example.com/api`) is not an origin and
    // must not be silently used as one.
    let (scheme, authority) = raw.split_once("://")?;
    let valid_scheme = !scheme.is_empty()
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    let valid_authority = !authority.is_empty() && !authority.contains(['/', '?', '#']);
    if !valid_scheme || !valid_authority {
        return None;
    }
    HeaderValue::try_from(raw).ok()
}

/// Pure clamp for [`max_pool_connections`].
fn clamp_pool_size(n: u32) -> u32 {
    n.clamp(MIN_POOL_SIZE, MAX_POOL_SIZE)
}

/// Resolves `LOCALES`, the configured locale pair (LOCALE-01/02): the
/// API-side mirror of the web tier's `NEXT_PUBLIC_LOCALES`. Exactly TWO
/// distinct BCP-47-style tags (see [`valid_locale_tag`], mirroring web
/// `parseLocales`), comma-separated, either order. Anything else — one tag,
/// three tags, duplicates, malformed tags — poisons the whole value
/// (warn-once) and falls back to [`DEFAULT_LOCALES`]: a locale set the web
/// tier never serves would strand content rows no route renders.
pub fn locales() -> Vec<String> {
    match std::env::var("LOCALES") {
        Ok(raw) => match parse_locales(&raw) {
            Some(locales) => locales,
            None => {
                LOCALES_WARN.call_once(|| {
                    warn!(
                        "LOCALES must be exactly two distinct locale tags (e.g. en,zh-HK); using default"
                    );
                });
                default_locales()
            }
        },
        Err(_) => default_locales(),
    }
}

fn default_locales() -> Vec<String> {
    DEFAULT_LOCALES.iter().map(|s| (*s).to_string()).collect()
}

/// Pure parse for [`locales`]: the pair mirror of web `parseLocales` —
/// exactly two distinct BCP-47-style tags. One bad entry rejects the value.
fn parse_locales(raw: &str) -> Option<Vec<String>> {
    let parts: Vec<String> = raw
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect();
    if parts.len() != 2 {
        return None;
    }
    if !parts.iter().all(|p| valid_locale_tag(p)) {
        return None;
    }
    if parts[0] == parts[1] {
        return None;
    }
    Some(parts)
}

/// One BCP-47-style locale tag, mirroring the web tier's `LOCALE_PATTERN`
/// (`[a-z]{2,3}(-[A-Za-z0-9]{2,8})*`): 2-3 lowercase letters, then
/// `-`-separated alphanumeric subtags of 2-8 chars each (e.g. `en`,
/// `zh-HK`, `zh-Hant-HK`).
fn valid_locale_tag(tag: &str) -> bool {
    let mut parts = tag.split('-');
    let primary = match parts.next() {
        Some(primary) => primary,
        None => return false,
    };
    let primary_len = primary.chars().count();
    if !(2..=3).contains(&primary_len) || !primary.chars().all(|c| c.is_ascii_lowercase()) {
        return false;
    }
    for subtag in parts {
        let len = subtag.chars().count();
        if !(2..=8).contains(&len) || !subtag.chars().all(|c| c.is_ascii_alphanumeric()) {
            return false;
        }
    }
    true
}

/// Resolves `REVALIDATE_URL`, the on-demand revalidation webhook target
/// (commitment 5b). Unset = webhook off (a silent, supported state). Set but
/// not an absolute `http://` URL (this includes `https://`) = warn-once and
/// webhook off: the webhook client is a bare hyper HTTP/1 client with no TLS
/// stack, and the web tier runs next to the API over plain HTTP.
pub fn revalidate_url() -> Option<String> {
    match std::env::var("REVALIDATE_URL") {
        Ok(raw) => match parse_revalidate_url(&raw) {
            Some(url) => Some(url),
            None => {
                REVALIDATE_URL_WARN.call_once(|| {
                    warn!(
                        "REVALIDATE_URL must be an absolute http:// URL (the webhook client has no TLS); revalidation webhook disabled"
                    );
                });
                None
            }
        },
        Err(_) => None,
    }
}

/// Resolves `REVALIDATE_SECRET`, the shared secret the web tier's revalidate
/// route checks (commitment 5b). Missing/blank with `REVALIDATE_URL` set =
/// warn-once and webhook off (an unauthenticated purge endpoint would be an
/// open cache-purge door). The secret value itself is never logged.
pub fn revalidate_secret() -> Option<String> {
    match std::env::var("REVALIDATE_SECRET") {
        Ok(raw) if !raw.trim().is_empty() => Some(raw.trim().to_string()),
        _ => {
            if std::env::var("REVALIDATE_URL").is_ok() {
                REVALIDATE_SECRET_WARN.call_once(|| {
                    warn!("REVALIDATE_URL is set but REVALIDATE_SECRET is missing; revalidation webhook disabled");
                });
            }
            None
        }
    }
}

/// Pure parse for [`revalidate_url`]: trimmed, absolute `http://` URL with a
/// non-empty `host[:port]` authority (no userinfo, no whitespace). Paths and
/// queries are allowed (`http://web:3000/api/revalidate` is the expected
/// shape). `https://` is deliberately rejected — keep in sync with
/// `admin_crud::webhook_target`, which splits the accepted shape for the
/// client.
fn parse_revalidate_url(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let rest = raw.strip_prefix("http://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.is_empty() || authority.contains(char::is_whitespace) || authority.contains('@') {
        return None;
    }
    // host[:port]: host non-empty; port, when present, a valid u16.
    match authority.split_once(':') {
        Some((host, port)) => {
            if host.is_empty() || port.parse::<u16>().is_err() {
                return None;
            }
        }
        None if authority.is_empty() => return None,
        None => {}
    }
    Some(raw.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cors_origin_accepts_valid_origins() {
        let v = parse_cors_origin("http://localhost:3000").expect("valid origin");
        assert_eq!(v, "http://localhost:3000");
        assert!(parse_cors_origin("https://shop.example.com").is_some());
        assert!(parse_cors_origin("  http://localhost:3000  ").is_some()); // trimmed
    }

    #[test]
    fn parse_cors_origin_rejects_invalid_values() {
        assert!(parse_cors_origin("").is_none());
        assert!(parse_cors_origin("   ").is_none());
        assert!(parse_cors_origin("localhost:3000").is_none()); // no scheme
        assert!(parse_cors_origin("http://bad origin").is_none()); // whitespace
                                                                   // Origin only: paths, queries and fragments are not origins.
        assert!(parse_cors_origin("https://shop.example.com/api").is_none());
        assert!(parse_cors_origin("https://shop.example.com?q=1").is_none());
        assert!(parse_cors_origin("https://shop.example.com/#frag").is_none());
        assert!(parse_cors_origin("://example.com").is_none()); // empty scheme
        assert!(parse_cors_origin("https://").is_none()); // empty authority
    }

    #[test]
    fn pool_size_is_clamped_to_1_through_64() {
        assert_eq!(clamp_pool_size(0), 1);
        assert_eq!(clamp_pool_size(1), 1);
        assert_eq!(clamp_pool_size(DEFAULT_POOL_SIZE), 5);
        assert_eq!(clamp_pool_size(MAX_POOL_SIZE), 64);
        assert_eq!(clamp_pool_size(65), 64);
        assert_eq!(clamp_pool_size(u32::MAX), 64);
    }

    #[test]
    fn session_secret_requires_at_least_32_bytes() {
        let secret = parse_session_secret("0123456789abcdef0123456789abcdef").expect("32 bytes");
        assert_eq!(secret, b"0123456789abcdef0123456789abcdef");
        assert!(parse_session_secret("0123456789abcdef0123456789abcdef!").is_some()); // longer is fine
        assert!(parse_session_secret("0123456789abcdef0123456789abcde").is_none()); // 31 bytes
        assert!(parse_session_secret("").is_none());
        assert!(parse_session_secret("   ").is_none());
    }

    #[test]
    fn session_secret_is_trimmed() {
        // A trailing newline from an env file must not count toward the
        // minimum, and must not silently become part of the key.
        let secret =
            parse_session_secret("  0123456789abcdef0123456789abcdef\n").expect("32 bytes");
        assert_eq!(secret, b"0123456789abcdef0123456789abcdef");
        assert!(parse_session_secret("0123456789abcdef0123456789abcde ").is_none());
        // 31 after trim
    }

    fn locales_vec(entries: &[&str]) -> Vec<String> {
        entries.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn parse_locales_accepts_exactly_the_distinct_pair() {
        assert_eq!(
            parse_locales("en,zh-HK"),
            Some(locales_vec(&["en", "zh-HK"]))
        );
        // Either order, trimmed, generic script-region tags.
        assert_eq!(
            parse_locales(" zh-HK , en "),
            Some(locales_vec(&["zh-HK", "en"]))
        );
        assert_eq!(
            parse_locales("en,zh-Hant-HK"),
            Some(locales_vec(&["en", "zh-Hant-HK"]))
        );
        // Multiple subtags are within the grammar (mirrors the web regex).
        assert_eq!(
            parse_locales("zh-Hant-419,en"),
            Some(locales_vec(&["zh-Hant-419", "en"]))
        );
    }

    #[test]
    fn parse_locales_rejects_not_a_pair_or_malformed() {
        // LOCALE-02 (pair restriction, mirrored from web parseLocales):
        assert_eq!(parse_locales(""), None); // empty value
        assert_eq!(parse_locales("   "), None);
        assert_eq!(parse_locales("en"), None); // ONE tag
        assert_eq!(parse_locales("en,zh-HK,fr"), None); // three tags
        assert_eq!(parse_locales("en,en"), None); // duplicate
        assert_eq!(parse_locales("en,"), None); // empty entry
        assert_eq!(parse_locales("en, zh HK"), None); // whitespace in a tag
        assert_eq!(parse_locales("en,zh_HK"), None); // underscore
        assert_eq!(parse_locales("en,zh.hk"), None); // dot
        assert_eq!(parse_locales("EN,zh-hk"), None); // uppercase primary
        assert_eq!(parse_locales("en,中文"), None); // non-ASCII
        assert_eq!(parse_locales("e,zh-HK"), None); // 1-letter primary
        assert_eq!(parse_locales("en,zh-H"), None); // 1-char subtag
        assert_eq!(parse_locales("zh-,en"), None); // empty subtag
        assert_eq!(parse_locales("en,zh-Hant-Kongkongx"), None); // 10-char subtag
    }

    #[test]
    fn parse_revalidate_url_accepts_absolute_http_urls() {
        assert_eq!(
            parse_revalidate_url("http://localhost:3000/api/revalidate"),
            Some("http://localhost:3000/api/revalidate".to_string())
        );
        assert!(parse_revalidate_url("  http://web:3000/api/revalidate  ").is_some()); // trimmed
        assert!(parse_revalidate_url("http://web:3000").is_some()); // no path
        assert!(parse_revalidate_url("http://127.0.0.1:8080/x?q=1").is_some()); // query
    }

    #[test]
    fn parse_revalidate_url_rejects_everything_else() {
        assert_eq!(parse_revalidate_url(""), None);
        assert_eq!(
            parse_revalidate_url("https://web:3000/api/revalidate"),
            None
        ); // no TLS client
        assert_eq!(parse_revalidate_url("web:3000/api/revalidate"), None); // no scheme
        assert_eq!(parse_revalidate_url("http://"), None); // no authority
        assert_eq!(parse_revalidate_url("http:// /x"), None); // whitespace host
        assert_eq!(parse_revalidate_url("http://user:pass@web/x"), None); // no credentials
        assert_eq!(parse_revalidate_url("http://web:notaport/x"), None); // bad port
        assert_eq!(parse_revalidate_url("http://web:99999/x"), None); // port out of range
    }

    #[test]
    fn parse_bool_accepts_common_spellings() {
        for raw in ["true", "TRUE", "1", "yes", "on", " true "] {
            assert_eq!(parse_bool(raw), Some(true), "{raw}");
        }
        for raw in ["false", "False", "0", "no", "off"] {
            assert_eq!(parse_bool(raw), Some(false), "{raw}");
        }
        assert_eq!(parse_bool(""), None);
        assert_eq!(parse_bool("maybe"), None);
        assert_eq!(parse_bool("2"), None);
    }
}
