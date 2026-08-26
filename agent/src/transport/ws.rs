use log::{debug, error, info, warn};
use std::net::TcpStream;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tungstenite::client::IntoClientRequest;
use tungstenite::http::HeaderValue;
use tungstenite::protocol::{Message, WebSocket};
use tungstenite::stream::MaybeTlsStream;
use url::Url;

use crate::error::{AgentError, AgentResult};
use crate::protocol::envelope::Envelope;
use crate::protocol::{
    ConfigAckData, ConfigData, HelloData, ReportData, ServerConfig, WelcomeData,
};

pub type WsStream = WebSocket<MaybeTlsStream<TcpStream>>;

pub struct WsTransport {
    socket: WsStream,
    instance_id: String,
    last_activity: Instant,
    last_ping_sent: Option<Instant>,
}

pub enum WsEvent {
    ConfigPushed(ServerConfig, u64),
    AckReceived(u64),
    FatalClose(u16, String),
    Disconnected(String),
}

impl WsTransport {
    pub fn connect(
        server_url: &str,
        node_id: &str,
        token: &str,
        instance_id: &str,
        allow_http: bool,
    ) -> AgentResult<Self> {
        let mut parsed = Url::parse(server_url)
            .map_err(|e| AgentError::Transport(format!("Invalid server URL: {}", e)))?;

        let scheme = match parsed.scheme() {
            "http" => {
                if !allow_http {
                    return Err(AgentError::Security(
                        "Insecure ws:// not allowed without --allow-http".to_string(),
                    ));
                }
                "ws"
            }
            "https" => "wss",
            "ws" => {
                if !allow_http {
                    return Err(AgentError::Security(
                        "Insecure ws:// not allowed without --allow-http".to_string(),
                    ));
                }
                "ws"
            }
            "wss" => "wss",
            other => {
                return Err(AgentError::Transport(format!(
                    "Unsupported scheme: {}",
                    other
                )));
            }
        };

        parsed
            .set_scheme(scheme)
            .map_err(|_| AgentError::Transport("Failed to set WebSocket scheme".to_string()))?;

        // Append stream path
        let stream_url = parsed
            .join("/api/agent/v1/stream")
            .map_err(|e| AgentError::Transport(format!("Failed to build stream URL: {}", e)))?;

        info!("[WSS] Connecting to {}", stream_url);

        let mut request = stream_url
            .as_str()
            .into_client_request()
            .map_err(|e| AgentError::Transport(format!("Failed to build WSS request: {}", e)))?;

        let headers = request.headers_mut();
        headers.insert(
            "Authorization",
            HeaderValue::from_str(&format!("Bearer {}", token))
                .map_err(|_| AgentError::Transport("Invalid token header".to_string()))?,
        );
        headers.insert(
            "X-Node-ID",
            HeaderValue::from_str(node_id)
                .map_err(|_| AgentError::Transport("Invalid node ID header".to_string()))?,
        );
        headers.insert(
            "X-Agent-Instance-ID",
            HeaderValue::from_str(instance_id)
                .map_err(|_| AgentError::Transport("Invalid instance ID header".to_string()))?,
        );
        headers.insert(
            "User-Agent",
            HeaderValue::from_static("EdgeMon-Agent/0.1.0"),
        );

        let (socket, response) = tungstenite::connect(request)
            .map_err(|e| AgentError::Transport(format!("WSS Handshake failed: {}", e)))?;

        info!("[WSS] Handshake successful (Status: {})", response.status());

        // Set TCP read timeout so socket.read() doesn't block indefinitely
        match socket.get_ref() {
            MaybeTlsStream::Plain(s) => {
                let _ = s.set_read_timeout(Some(Duration::from_millis(500)));
            }
            MaybeTlsStream::Rustls(s) => {
                let _ = s
                    .get_ref()
                    .set_read_timeout(Some(Duration::from_millis(500)));
            }
            _ => {}
        }

        let now = Instant::now();
        Ok(Self {
            socket,
            instance_id: instance_id.to_string(),
            last_activity: now,
            last_ping_sent: None,
        })
    }

    pub fn send_hello(&mut self, seq: u64, payload: HelloData) -> AgentResult<WelcomeData> {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let envelope = Envelope::new("hello", &self.instance_id, seq, now_ms, payload);
        let json_str = serde_json::to_string(&envelope)?;

        self.socket
            .send(Message::Text(json_str))
            .map_err(|e| AgentError::Transport(format!("Failed to send hello frame: {}", e)))?;

        info!(
            "[WSS] Sent hello frame (seq: {}), waiting for welcome...",
            seq
        );

        // Wait for welcome response with 10s deadline
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if Instant::now() > deadline {
                return Err(AgentError::Transport(
                    "Timeout waiting for welcome frame".to_string(),
                ));
            }

            match self.socket.read() {
                Ok(Message::Text(text)) => {
                    self.last_activity = Instant::now();
                    self.last_ping_sent = None;
                    let env: serde_json::Value = serde_json::from_str(&text)?;
                    if env.get("type").and_then(|t| t.as_str()) == Some("welcome") {
                        let welcome_env: Envelope<WelcomeData> = serde_json::from_value(env)?;
                        info!(
                            "[WSS] Received welcome! Config rev: {}",
                            welcome_env.data.config_rev
                        );
                        return Ok(welcome_env.data);
                    } else if env.get("type").and_then(|t| t.as_str()) == Some("error") {
                        let err_msg = env
                            .get("data")
                            .and_then(|d| d.get("message"))
                            .and_then(|m| m.as_str())
                            .unwrap_or("Unknown server error");
                        return Err(AgentError::Protocol(err_msg.to_string()));
                    }
                }
                Ok(Message::Ping(data)) => {
                    self.last_activity = Instant::now();
                    let _ = self.socket.send(Message::Pong(data));
                }
                Ok(Message::Pong(_)) => {
                    self.last_activity = Instant::now();
                    self.last_ping_sent = None;
                }
                Ok(Message::Close(frame)) => {
                    let reason = frame
                        .map(|f| format!("{}: {}", f.code, f.reason))
                        .unwrap_or_default();
                    return Err(AgentError::Transport(format!(
                        "Server closed socket during hello: {}",
                        reason
                    )));
                }
                Err(tungstenite::Error::Io(ref e))
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(e) => {
                    return Err(AgentError::Transport(format!(
                        "Error reading welcome frame: {}",
                        e
                    )));
                }
                _ => {}
            }
        }
    }

    pub fn send_report(&mut self, seq: u64, report: ReportData) -> AgentResult<()> {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let envelope = Envelope::new("report", &self.instance_id, seq, now_ms, report);
        let json_str = serde_json::to_string(&envelope)?;

        self.socket
            .send(Message::Text(json_str))
            .map_err(|e| AgentError::Transport(format!("Failed to send report frame: {}", e)))?;

        Ok(())
    }

    pub fn send_config_ack(&mut self, seq: u64, config_rev: u64) -> AgentResult<()> {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let ack_data = ConfigAckData {
            config_rev,
            status: "applied".to_string(),
            reason: None,
        };

        let envelope = Envelope::new("config_ack", &self.instance_id, seq, now_ms, ack_data);
        let json_str = serde_json::to_string(&envelope)?;

        self.socket
            .send(Message::Text(json_str))
            .map_err(|e| AgentError::Transport(format!("Failed to send config_ack: {}", e)))?;

        info!("[WSS] Confirmed config revision {}", config_rev);
        Ok(())
    }

    pub fn tick_keepalive(&mut self) -> AgentResult<()> {
        let now = Instant::now();

        // 1. Check Pong Timeout if ping was sent
        if let Some(ping_time) = self.last_ping_sent {
            if now.duration_since(ping_time) >= Duration::from_secs(10) {
                return Err(AgentError::Transport(
                    "Pong timeout: no keepalive response from server".to_string(),
                ));
            }
        }

        // 2. Send 30s RFC6455 Ping
        if now.duration_since(self.last_activity) >= Duration::from_secs(30)
            && self.last_ping_sent.is_none()
        {
            self.socket.send(Message::Ping(vec![])).map_err(|e| {
                AgentError::Transport(format!("Failed to send RFC6455 Ping: {}", e))
            })?;
            self.last_ping_sent = Some(now);
            debug!("[WSS] Sent RFC6455 Ping");
        }

        Ok(())
    }

    pub fn poll_incoming(&mut self) -> Option<WsEvent> {
        match self.socket.read() {
            Ok(Message::Text(text)) => {
                self.last_activity = Instant::now();
                self.last_ping_sent = None;
                if let Ok(env) = serde_json::from_str::<serde_json::Value>(&text) {
                    let msg_type = env.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    match msg_type {
                        "config" => {
                            if let Ok(config_env) =
                                serde_json::from_value::<Envelope<ConfigData>>(env)
                            {
                                info!(
                                    "[WSS] Server pushed new config rev {}",
                                    config_env.data.config_rev
                                );
                                return Some(WsEvent::ConfigPushed(
                                    config_env.data.config,
                                    config_env.data.config_rev,
                                ));
                            }
                        }
                        "ack" => {
                            let rev = env
                                .get("data")
                                .and_then(|d| d.get("config_rev"))
                                .and_then(|r| r.as_u64())
                                .unwrap_or(0);
                            return Some(WsEvent::AckReceived(rev));
                        }
                        "error" => {
                            let msg = env
                                .get("data")
                                .and_then(|d| d.get("message"))
                                .and_then(|m| m.as_str())
                                .unwrap_or("");
                            warn!("[WSS] Server error notice: {}", msg);
                        }
                        _ => {}
                    }
                }
                None
            }
            Ok(Message::Ping(data)) => {
                self.last_activity = Instant::now();
                let _ = self.socket.send(Message::Pong(data));
                None
            }
            Ok(Message::Pong(_)) => {
                self.last_activity = Instant::now();
                self.last_ping_sent = None;
                debug!("[WSS] Received Pong");
                None
            }
            Ok(Message::Close(frame)) => {
                if let Some(f) = frame {
                    let code: u16 = f.code.into();
                    let reason = f.reason.to_string();
                    if code == 4003 || code == 4004 {
                        error!(
                            "[WSS] Fatal auth/policy close from server ({}: {}). Terminating.",
                            code, reason
                        );
                        return Some(WsEvent::FatalClose(code, reason));
                    }
                    return Some(WsEvent::Disconnected(format!("Close {}: {}", code, reason)));
                }
                Some(WsEvent::Disconnected("Close frame received".to_string()))
            }
            Err(tungstenite::Error::Io(ref e))
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                None
            }
            Err(e) => {
                warn!("[WSS] Read error: {}", e);
                Some(WsEvent::Disconnected(format!("Read error: {}", e)))
            }
            _ => None,
        }
    }
}
