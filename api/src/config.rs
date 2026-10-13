//! Runtime configuration knobs (ENV-01): every deployable scalar comes from
//! the environment with a safe default, never an inline literal. An invalid or
//! unparseable value logs a warning and falls back to the default rather than
//! failing boot.
//!
//! The parsing/clamping rules live in pure functions so they are unit-testable
//! without touching process environment (which would race across parallel
//! tests).

use axum::http::HeaderValue;
use tracing::warn;

/// Default allowed browser origin: the local web app during development.
pub const DEFAULT_CORS_ORIGIN: &str = "http://localhost:3000";

/// Default Postgres pool size.
pub const DEFAULT_POOL_SIZE: u32 = 5;

/// Pool size bounds: a pool of 0 stalls every request; an unbounded pool
/// exhausts Postgres connections under load.
pub const MIN_POOL_SIZE: u32 = 1;
pub const MAX_POOL_SIZE: u32 = 64;

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
}
