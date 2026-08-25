use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub struct Backoff {
    step_index: usize,
    steps: &'static [u64],
}

const BACKOFF_STEPS: &[u64] = &[1, 2, 4, 8, 16, 30, 60];

impl Backoff {
    pub fn new() -> Self {
        Self {
            step_index: 0,
            steps: BACKOFF_STEPS,
        }
    }

    pub fn next_delay(&mut self) -> Duration {
        let base_secs = self.steps[self.step_index.min(self.steps.len() - 1)];
        if self.step_index < self.steps.len() - 1 {
            self.step_index += 1;
        }

        // Add +/- 20% jitter
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos();
        let jitter_factor = 0.8 + ((nanos % 400) as f64 / 1000.0); // 0.80 .. 1.20
        let actual_secs = (base_secs as f64 * jitter_factor).max(0.5);

        Duration::from_secs_f64(actual_secs)
    }

    pub fn reset(&mut self) {
        self.step_index = 0;
    }
}

impl Default for Backoff {
    fn default() -> Self {
        Self::new()
    }
}
