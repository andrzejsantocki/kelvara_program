pub const PAUSED: u16 = 1;
pub const NAV_JUMP: u16 = 1 << 1;
pub const AUTHORITY_CHANGED: u16 = 1 << 2;
pub const ALL_SCENARIOS: u16 = PAUSED | NAV_JUMP | AUTHORITY_CHANGED;
pub const MIN_TTL_SECONDS: i64 = 30;
pub const MAX_TTL_SECONDS: i64 = 300;

pub fn validate_ttl(ttl_seconds: i64) -> bool {
    (MIN_TTL_SECONDS..=MAX_TTL_SECONDS).contains(&ttl_seconds)
}

pub fn validate_flags(flags: u16) -> bool {
    flags != 0 && flags & !ALL_SCENARIOS == 0
}

pub fn effective_flags(stored_flags: u16, now: i64, expires_at: i64) -> u16 {
    if now >= expires_at { 0 } else { stored_flags }
}

pub const PROTECTION_FEE_BPS: u64 = 100;

pub fn protection_terms(amount: u64) -> Option<(u64, u64)> {
    let fee = amount.checked_mul(PROTECTION_FEE_BPS)?.checked_div(10_000)?;
    Some((fee, amount))
}

pub fn can_evacuate(flags: u16, protected: bool, evacuated: bool) -> bool {
    flags != 0 && protected && !evacuated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ttl_is_bounded_for_public_demo_sessions() {
        assert!(!validate_ttl(29));
        assert!(validate_ttl(30));
        assert!(validate_ttl(300));
        assert!(!validate_ttl(301));
    }

    #[test]
    fn only_known_nonzero_scenario_flags_are_valid() {
        assert!(validate_flags(PAUSED));
        assert!(validate_flags(PAUSED | NAV_JUMP | AUTHORITY_CHANGED));
        assert!(!validate_flags(0));
        assert!(!validate_flags(1 << 8));
    }

    #[test]
    fn expired_sessions_logically_restore_baseline() {
        assert_eq!(effective_flags(PAUSED | NAV_JUMP, 99, 100), PAUSED | NAV_JUMP);
        assert_eq!(effective_flags(PAUSED | NAV_JUMP, 100, 100), 0);
        assert_eq!(effective_flags(PAUSED | NAV_JUMP, 101, 100), 0);
    }

    #[test]
    fn protection_fee_is_separate_and_full_principal_is_evacuated() {
        assert_eq!(protection_terms(1_000_000_000), Some((10_000_000, 1_000_000_000)));
        assert_eq!(protection_terms(u64::MAX), None);
    }

    #[test]
    fn evacuation_requires_breach_and_unused_protection() {
        assert!(!can_evacuate(0, true, false));
        assert!(!can_evacuate(PAUSED, false, false));
        assert!(!can_evacuate(PAUSED, true, true));
        assert!(can_evacuate(AUTHORITY_CHANGED, true, false));
    }
}
