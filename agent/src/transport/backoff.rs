use std::time::Duration;

pub struct Backoff {
    min: Duration,
    max: Duration,
    current: Duration,
    factor: f64,
}

impl Backoff {
    pub fn new(min: Duration, max: Duration) -> Self {
        Self {
            min,
            max,
            current: min,
            factor: 1.5,
        }
    }

    pub fn next_delay(&mut self) -> Duration {
        let delay = self.current;
        let next_secs = (self.current.as_secs_f64() * self.factor).min(self.max.as_secs_f64());
        self.current = Duration::from_secs_f64(next_secs);
        delay
    }

    pub fn reset(&mut self) {
        self.current = self.min;
    }
}
