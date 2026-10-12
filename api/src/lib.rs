//! Shared helpers for the HAVN API.
//!
//! The Axum server lives in the binary target (`src/main.rs`); anything reusable
//! (and unit-testable on its own) belongs here.

pub mod money;
pub mod slug;
