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
