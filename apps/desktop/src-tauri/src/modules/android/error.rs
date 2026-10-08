use serde::Serialize;

/// Machine-readable failure. The frontend turns `code` into a sentence the
/// user can act on; `detail` keeps the raw cause for logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    AdbMissing,
    AdbInvalidPath,
    NoDevice,
    Unauthorized,
    Offline,
    Disconnected,
    Timeout,
    Unsupported,
    FfmpegMissing,
    InvalidInput,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct AndroidError {
    pub code: ErrorCode,
    pub detail: String,
}

impl AndroidError {
    pub fn new(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self { code, detail: detail.into() }
    }
}

impl std::fmt::Display for AndroidError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.detail)
    }
}
