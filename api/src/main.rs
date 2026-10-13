//! lamp API — Axum server.
//!
//! Config from the environment (ENV-01; see `lamp_api::config`):
//! - `DATABASE_URL` — optional at boot. Without it the server still serves
//!   `/health`; the `/api/*` data endpoints return 503 with a clear JSON error.
//! - `PORT` — listen port, default 8080.
//! - `CORS_ORIGIN` — allowed browser origin, default `http://localhost:3000`.
//! - `MAX_POOL_CONNECTIONS` — Postgres pool size, default 5 (clamped to 1..=64).

use std::net::SocketAddr;

use anyhow::Context;
use axum::{extract::State, http::header, routing::get, Json, Router};
use chrono::{DateTime, Utc};
use lamp_api::{
    catalogue, config, content,
    state::{self, AppState},
};
use serde::Serialize;
use sqlx::{postgres::PgPoolOptions, FromRow};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

/// A product row for `/api/products` — the fail-closed availability channel.
/// `price_cents` is integer HKD cents — money is never a float.
///
/// No `colourway`: migration 0002 moved colour copy into locale-keyed
/// `product_content` rows served by `/api/catalogue`. This response carries
/// stock (`stock_total`/`stock_reserved`); the catalogue deliberately does not.
#[derive(Debug, Serialize, FromRow)]
struct Product {
    id: i64,
    slug: String,
    brand: String,
    model: String,
    price_cents: i64,
    stock_total: i32,
    stock_reserved: i32,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
struct HealthBody {
    status: &'static str,
}

async fn health() -> Json<HealthBody> {
    Json(HealthBody { status: "ok" })
}

async fn list_products(
    State(app): State<AppState>,
) -> Result<
    (
        [(axum::http::HeaderName, &'static str); 1],
        Json<Vec<Product>>,
    ),
    state::ApiError,
> {
    let pool = state::require_pool(&app)?;

    let products = sqlx::query_as::<_, Product>(
        "SELECT id, slug, brand, model, price_cents, \
             stock_total, stock_reserved, created_at \
         FROM products ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| state::database_unavailable("failed to load products", &e))?;

    // Stock is live data: no layer (browser, CDN, proxy) may cache this
    // response (commitment 5b; the web tier already fetches no-store, the
    // header keeps any direct consumer honest).
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(products)))
}

fn app(state: AppState) -> Router {
    // Permissive methods/headers, but the origin is locked to CORS_ORIGIN
    // (default: the local web app).
    let cors = CorsLayer::new()
        .allow_origin(config::cors_origin())
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(health))
        .route("/api/products", get(list_products))
        .route("/api/catalogue", get(catalogue::get_catalogue))
        .route("/api/site-content", get(content::get_site_content))
        .route("/api/settings", get(content::get_settings))
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info")),
        )
        .init();

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8080);

    // Lazy pool: an unreachable database never prevents boot (see AppState).
    let pool = match std::env::var("DATABASE_URL") {
        Ok(url) => {
            let pool = PgPoolOptions::new()
                .max_connections(config::max_pool_connections())
                .connect_lazy(&url)
                .context("DATABASE_URL is not a valid Postgres URL")?;
            info!("DATABASE_URL set; /api/* will query Postgres");
            Some(pool)
        }
        Err(_) => {
            warn!("DATABASE_URL not set; /health works, /api/* returns 503");
            None
        }
    };

    let app = app(AppState { pool });

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind {addr}"))?;
    info!("listening on {addr}");
    axum::serve(listener, app).await.context("server error")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt; // oneshot

    #[tokio::test]
    async fn health_returns_ok() {
        let response = app(AppState { pool: None })
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), 1024).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["status"], "ok");
    }

    #[tokio::test]
    async fn products_503_without_database() {
        let response = app(AppState { pool: None })
            .oneshot(
                Request::builder()
                    .uri("/api/products")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
        let text = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(text.contains("database not configured"));
    }

    /// Shared contract for the D1.2 read endpoints: without `DATABASE_URL`
    /// each returns the exact 503 body the web tier already handles.
    async fn assert_database_not_configured(uri: &str) {
        let response = app(AppState { pool: None })
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
        let text = String::from_utf8(bytes.to_vec()).unwrap();
        assert_eq!(
            text,
            "{\"error\":\"database not configured: set DATABASE_URL\"}"
        );
    }

    #[tokio::test]
    async fn catalogue_503_without_database() {
        assert_database_not_configured("/api/catalogue").await;
    }

    #[tokio::test]
    async fn site_content_503_without_database() {
        assert_database_not_configured("/api/site-content").await;
    }

    #[tokio::test]
    async fn settings_503_without_database() {
        assert_database_not_configured("/api/settings").await;
    }

    #[tokio::test]
    async fn products_error_does_not_leak_driver_details() {
        // Lazy pool aimed at a dead address: the query fails at use, and the client
        // must see only the generic message, never the raw sqlx error (which embeds
        // the connection target and can embed credentials).
        let pool = PgPoolOptions::new()
            .connect_lazy("postgres://127.0.0.1:1/none")
            .unwrap();
        let response = app(AppState { pool: Some(pool) })
            .oneshot(
                Request::builder()
                    .uri("/api/products")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let bytes = to_bytes(response.into_body(), 8192).await.unwrap();
        let text = String::from_utf8(bytes.to_vec()).unwrap();
        assert_eq!(text, "{\"error\":\"database unavailable\"}");
        assert!(!text.contains("127.0.0.1"));
    }

    #[tokio::test]
    async fn data_endpoints_do_not_leak_driver_details() {
        // Same leak-proofing contract for the D1.2 endpoints: a failing query
        // yields the generic body, never the driver error. The short acquire
        // timeout keeps this test fast; the contract under test is the error
        // mapping, not the timing of a dead TCP connect.
        for uri in ["/api/catalogue", "/api/site-content", "/api/settings"] {
            let pool = PgPoolOptions::new()
                .acquire_timeout(std::time::Duration::from_secs(2))
                .connect_lazy("postgres://127.0.0.1:1/none")
                .unwrap();
            let response = app(AppState { pool: Some(pool) })
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE, "{uri}");
            let bytes = to_bytes(response.into_body(), 8192).await.unwrap();
            let text = String::from_utf8(bytes.to_vec()).unwrap();
            assert_eq!(text, "{\"error\":\"database unavailable\"}", "{uri}");
            assert!(!text.contains("127.0.0.1"), "{uri}");
        }
    }
}
