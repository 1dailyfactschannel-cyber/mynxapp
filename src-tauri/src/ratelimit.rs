//! Brute-force backoff logic shared by vault unlock and the local HTTP API.
//!
//! The delay computation is a pure function (`backoff_delay`) so it can be
//! unit-tested without real waiting; the stateful part (`AttemptTrackerMap`)
//! only records failure counts and timestamps in memory.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Number of consecutive failures tolerated before any delay kicks in.
pub const BACKOFF_THRESHOLD: u32 = 5;
/// First delay once the threshold is reached.
pub const BASE_DELAY_SECS: u64 = 5;
/// Hard cap for the exponential growth.
pub const MAX_DELAY_SECS: u64 = 300; // 5 minutes

/// Exponential backoff after `BACKOFF_THRESHOLD` consecutive failures:
/// 5s, 10s, 20s, ... capped at `MAX_DELAY_SECS`. Below the threshold
/// there is no delay.
pub fn backoff_delay(failures: u32) -> Duration {
    if failures < BACKOFF_THRESHOLD {
        return Duration::ZERO;
    }
    // Exponent is clamped so the shift can never overflow.
    let exp = (failures - BACKOFF_THRESHOLD).min(20);
    let secs = BASE_DELAY_SECS
        .saturating_mul(1u64 << exp)
        .min(MAX_DELAY_SECS);
    Duration::from_secs(secs)
}

/// Failure counter + last failure instant for one key (vault id, API token, ...).
#[derive(Default)]
pub struct AttemptTracker {
    failures: u32,
    last_failure: Option<Instant>,
}

impl AttemptTracker {
    /// Remaining lockout time if a backoff delay is currently in effect.
    pub fn retry_after(&self, now: Instant) -> Option<Duration> {
        let last = self.last_failure?;
        let wait = backoff_delay(self.failures);
        if wait.is_zero() {
            return None;
        }
        let elapsed = now.saturating_duration_since(last);
        (elapsed < wait).then(|| wait - elapsed)
    }

    pub fn record_failure(&mut self, now: Instant) {
        self.failures = self.failures.saturating_add(1);
        self.last_failure = Some(now);
    }
}

/// In-memory per-key attempt trackers (one entry per vault id, etc.).
/// Never persisted: a restart clears the counters, which is acceptable —
/// Argon2 itself makes offline-free online guessing impractical.
#[derive(Default)]
pub struct AttemptTrackerMap {
    inner: Mutex<HashMap<String, AttemptTracker>>,
}

impl AttemptTrackerMap {
    pub fn new() -> Self {
        Self::default()
    }

    /// Remaining lockout for `key`, if the caller must wait before retrying.
    pub fn retry_after(&self, key: &str) -> Option<Duration> {
        let map = self.inner.lock().unwrap();
        map.get(key).and_then(|t| t.retry_after(Instant::now()))
    }

    pub fn record_failure(&self, key: &str) {
        let mut map = self.inner.lock().unwrap();
        map.entry(key.to_string())
            .or_default()
            .record_failure(Instant::now());
    }

    /// Clear the counter after a successful attempt.
    pub fn reset(&self, key: &str) {
        let mut map = self.inner.lock().unwrap();
        map.remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_delay_below_threshold() {
        for failures in 0..BACKOFF_THRESHOLD {
            assert_eq!(backoff_delay(failures), Duration::ZERO);
        }
    }

    #[test]
    fn delay_doubles_from_base() {
        assert_eq!(backoff_delay(5), Duration::from_secs(5));
        assert_eq!(backoff_delay(6), Duration::from_secs(10));
        assert_eq!(backoff_delay(7), Duration::from_secs(20));
        assert_eq!(backoff_delay(8), Duration::from_secs(40));
    }

    #[test]
    fn delay_is_capped() {
        assert_eq!(backoff_delay(100), Duration::from_secs(MAX_DELAY_SECS));
        assert_eq!(backoff_delay(u32::MAX), Duration::from_secs(MAX_DELAY_SECS));
    }

    #[test]
    fn retry_after_counts_down() {
        let mut tracker = AttemptTracker::default();
        let t0 = Instant::now();
        for _ in 0..BACKOFF_THRESHOLD {
            tracker.record_failure(t0);
        }
        // Right after the 5th failure the full base delay is pending.
        assert_eq!(tracker.retry_after(t0), Some(Duration::from_secs(5)));
        // Half-way through, half remains.
        assert_eq!(
            tracker.retry_after(t0 + Duration::from_secs(2)),
            Some(Duration::from_secs(3))
        );
        // Once the delay elapsed the attempt is allowed again.
        assert_eq!(tracker.retry_after(t0 + Duration::from_secs(5)), None);
    }

    #[test]
    fn map_reset_clears_lockout() {
        let map = AttemptTrackerMap::new();
        for _ in 0..BACKOFF_THRESHOLD {
            map.record_failure("vault-a");
        }
        assert!(map.retry_after("vault-a").is_some());
        // Failures of one vault never lock out another.
        assert!(map.retry_after("vault-b").is_none());

        map.reset("vault-a");
        assert!(map.retry_after("vault-a").is_none());
    }
}
