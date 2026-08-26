use crate::error::{AgentError as EdgeMonError, AgentResult as Result};
use crate::protocol::{AckData, Envelope, ErrorData, HelloData, ReportPayload, WelcomeData};
use std::time::Duration;
use ureq::{Agent, AgentBuilder};

pub struct HttpClient {
    server_url: String,
    node_id: String,
    token: String,
    agent: Agent,
}

impl HttpClient {
    pub fn new(server_url: String, node_id: String, token: String) -> Self {
        let agent = AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout_read(Duration::from_secs(10))
            .timeout_write(Duration::from_secs(10))
            .build();

        Self {
            server_url: server_url.trim_end_matches('/').to_string(),
            node_id,
            token,
            agent,
        }
    }

    pub fn send_hello(&self, envelope: &Envelope<HelloData>) -> Result<WelcomeData> {
        let url = format!("{}/api/agent/v1/hello", self.server_url);
        let resp = self
            .agent
            .post(&url)
            .set("Authorization", &format!("Bearer {}", self.token))
            .set("X-Node-ID", &self.node_id)
            .set("Content-Type", "application/json")
            .set(
                "User-Agent",
                &format!("EdgeMon-Agent/{}", env!("CARGO_PKG_VERSION")),
            )
            .send_json(envelope);

        match resp {
            Ok(r) => {
                let parsed: Envelope<WelcomeData> = r.into_json().map_err(|e| {
                    EdgeMonError::Protocol(format!("Failed to parse welcome response: {e}"))
                })?;
                Ok(parsed.data)
            }
            Err(ureq::Error::Status(status, r)) => {
                let err_data: Option<Envelope<ErrorData>> = r.into_json().ok();
                if let Some(err) = err_data {
                    Err(EdgeMonError::Protocol(format!(
                        "Server returned status {status} ({}) : {}",
                        err.data.code, err.data.message
                    )))
                } else {
                    Err(EdgeMonError::Protocol(format!(
                        "Server returned HTTP status {status}"
                    )))
                }
            }
            Err(ureq::Error::Transport(t)) => Err(EdgeMonError::Network(t.to_string())),
        }
    }

    pub fn send_report(&self, envelope: &Envelope<ReportPayload>) -> Result<AckData> {
        let url = format!("{}/api/agent/v1/report", self.server_url);
        let resp = self
            .agent
            .post(&url)
            .set("Authorization", &format!("Bearer {}", self.token))
            .set("X-Node-ID", &self.node_id)
            .set("Content-Type", "application/json")
            .set(
                "User-Agent",
                &format!("EdgeMon-Agent/{}", env!("CARGO_PKG_VERSION")),
            )
            .send_json(envelope);

        match resp {
            Ok(r) => {
                let parsed: Envelope<AckData> = r.into_json().map_err(|e| {
                    EdgeMonError::Protocol(format!("Failed to parse ack response: {e}"))
                })?;
                Ok(parsed.data)
            }
            Err(ureq::Error::Status(status, r)) => {
                let err_data: Option<Envelope<ErrorData>> = r.into_json().ok();
                if let Some(err) = err_data {
                    Err(EdgeMonError::Protocol(format!(
                        "Server returned status {status} ({}) : {}",
                        err.data.code, err.data.message
                    )))
                } else {
                    Err(EdgeMonError::Protocol(format!(
                        "Server returned HTTP status {status}"
                    )))
                }
            }
            Err(ureq::Error::Transport(t)) => Err(EdgeMonError::Network(t.to_string())),
        }
    }
}
