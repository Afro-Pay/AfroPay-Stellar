# Fee and Currency Conversion Primitives

## Overview
This module provides reusable primitives for fee calculation and currency conversion.

## Fee Configuration

| Parameter | Description | Example |
|-----------|-------------|---------|
| base_fee_rate | Fee rate in basis points | 100 = 1% |
| min_fee | Minimum fee amount | 0.001 token |
| max_fee | Maximum fee amount | 1 token |
| fee_recipient | Address receiving fees | G... |

## Functions

### calculate_fee
Calculates fee based on amount and configuration.

### convert_currency
Converts amount from one asset to another.

### calculate_fee_with_conversion
Converts currency then calculates fee on converted amount.

## Storage
- Conversion rates are stored by asset identifier
- Fee configuration is stored separately

## Arithmetic Safety & Rounding Convention

All `i128` arithmetic in `fee-primitives/src/lib.rs` was audited for overflow
and rounding correctness (see #193).

### Fee rounding — always in favor of the protocol
`calculate_fee` computes `amount * base_fee_rate / BASIS_POINTS_DENOMINATOR`
(`BASIS_POINTS_DENOMINATOR = 10_000`) using **ceiling division**: any
non-zero remainder rounds the fee **up**. Truncating division would silently
under-charge by up to one unit on every call — a systematic revenue loss for
the protocol over a large volume of transactions. Rounding up guarantees the
protocol never collects less than the exact basis-point rate implies.

`convert_currency`, by contrast, is a value transformation rather than a
protocol charge, and uses standard truncating (floor) division — the payer
never receives fractional-unit value manufactured by rounding up an asset
conversion. Because any fee subsequently charged on a converted amount (via
`calculate_fee_with_conversion`) still rounds up, protocol revenue is
unaffected by this choice.

### Overflow handling
Every multiplication site (`amount * base_fee_rate`, `amount * rate.rate`)
uses `checked_mul` rather than a raw `*`:

- **`calculate_fee`**: if `amount.checked_mul(base_fee_rate)` overflows
  `i128`, the *true* fee is necessarily far larger than `config.max_fee`
  (which already bounds the maximum fee the protocol will ever collect), so
  the result is clamped directly to `max_fee` instead of computing an
  unrepresentable product.
- **`convert_currency`**: there is no configured ceiling to fall back to for
  a currency conversion, so an overflow here is a genuine error and panics
  with a descriptive message rather than wrapping or truncating silently.

### Invariants enforced
- `amount`, `min_fee`, `max_fee`, and `base_fee_rate` must all be
  non-negative; `min_fee` must not exceed `max_fee`; `base_fee_rate` cannot
  exceed `10_000` basis points (100%). Violations panic with a descriptive
  message.
- The computed fee is never negative.
- The computed fee never exceeds the `amount` it is charged against, even if
  `min_fee` is configured above `amount` — this protects the payer and holds
  unconditionally.

These invariants are covered by property-based tests in
`fee-primitives/src/lib.rs` (`prop_*` tests), run with `cargo test -p
fee-primitives` from the `contracts/` workspace.
