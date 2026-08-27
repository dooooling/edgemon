use std::fmt;

#[derive(Debug)]
pub enum EdgeMonError {
    Config(String),
    Io(std::io::Error),
    Json(serde_json::Error),
    Protocol(String),
    Network(String),
    Transport(String),
    Security(String),
    Fatal(String),
}

impl fmt::Display for EdgeMonError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Config(msg) => write!(f, "Configuration error: {msg}"),
            Self::Io(err) => write!(f, "I/O error: {err}"),
            Self::Json(err) => write!(f, "JSON serialization error: {err}"),
            Self::Protocol(msg) => write!(f, "Protocol error: {msg}"),
            Self::Network(msg) => write!(f, "Network error: {msg}"),
            Self::Transport(msg) => write!(f, "Transport error: {msg}"),
            Self::Security(msg) => write!(f, "Security violation: {msg}"),
            Self::Fatal(msg) => write!(f, "Fatal shutdown: {msg}"),
        }
    }
}

impl std::error::Error for EdgeMonError {}

impl From<std::io::Error> for EdgeMonError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

impl From<serde_json::Error> for EdgeMonError {
    fn from(err: serde_json::Error) -> Self {
        Self::Json(err)
    }
}

pub type AgentError = EdgeMonError;
pub type AgentResult<T> = std::result::Result<T, EdgeMonError>;
pub type Result<T> = AgentResult<T>;
