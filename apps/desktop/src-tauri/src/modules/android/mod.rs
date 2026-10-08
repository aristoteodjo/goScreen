//! Android as a content source: device discovery, live screen and input over
//! ADB. Independent from the Device Registry, which only describes looks.

mod adb;
pub mod commands;
mod error;
mod parse;
mod stream;

pub use commands::AndroidState;
