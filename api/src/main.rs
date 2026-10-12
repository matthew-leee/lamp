//! HAVN API — Axum server.
//!
//! Config from the environment:
//! - `DATABASE_URL` — optional at boot. Without it the server still serves
//!   `/health`; `/api/products` returns 503 with a clear JSON error.
//! - `PORT` — listen port, default 8080.

use std::net::SocketAddr;

use anyhow::Context;
use axum::{
    extract::State,
    http::{HeaderValue, StatusCode},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{postgres::PgPoolOptions, FromRow, PgPool};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

/// A product row. `price_cents` is integer HKD cents — money is never a float.
#[derive(Debug, Serialize, FromRow)]
struct Product {
    id: i64,
    slug: String,
    brand: String,
    model: String,
    colourway: String,
    price_cents: i64,
    stock_total: i32,
    stock_reserved: i32,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
struct HealthBody {
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: String,
}

#[derive(Clone)]
struct AppState {
    /// `None` when `DATABASE_URL` is not set: the server boots regardless and
    /// `/api/products` reports 503 instead of taking the whole process down.
    pool: Option<PgPool>,
}

async fn health() -> Json<HealthBody> {
    Json(HealthBody { status: "ok" })
}

async fn list_products(
    State(state): State<AppState>,
) -> Result<Json<Vec<Product>>, (StatusCode, Json<ErrorBody>)> {
    let pool = state.pool.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorBody {
                error: "database not configured: set DATABASE_URL".to_string(),
            }),
        )
    })?;

    let products = sqlx::query_as::<_, Product>(
        "SELECT id, slug, brand, model, colourway, price_cents, \
             stock_total, stock_reserved, created_at \
         FROM products ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| {
        error!(error = %e, "failed to load products");
        // Client gets a generic message; the raw driver error (which can contain
        // connection strings, usernames and schema detail) stays in the logs only.
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorBody {
                error: "database unavailable".to_string(),
            }),
        )
    })?;

    Ok(Json(products))
}

fn app(state: AppState) -> Router {
    // Permissive methods/headers, but the origin is locked to the local web app.
    let cors = CorsLayer::new()
        .allow_origin(HeaderValue::from_static("http://localhost:3000"))
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(health))
        .route("/api/products", get(list_products))
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
                .max_connections(5)
                .connect_lazy(&url)
                .context("DATABASE_URL is not a valid Postgres URL")?;
            info!("DATABASE_URL set; /api/products will query Postgres");
            Some(pool)
        }
        Err(_) => {
            warn!("DATABASE_URL not set; /health works, /api/products returns 503");
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
    use axum::http::Request;
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
}
