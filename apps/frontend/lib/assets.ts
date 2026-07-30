/**
 * Static registry of assets the SendForm lets the user pick from.
 *
 * Native XLM has no issuer (Stellar treats it as a special, issuer-less
 * asset; the SDK signal is `asset.isNative()`). Every other supported
 * asset lists its anchor / issuer friendly-name *and* the issuer public
 * key so the picker can surface both.
 *
 * NOTE: Issuer addresses below are real public anchors on public network
 * (intended purely as display metadata for the UI demo); production
 * deployments should source these from a backend /anchor config when
 * those catalog endpoints become available.
 */

export type Asset = {
  /** Short code shown everywhere (e.g. "XLM", "USDC"). */
  code: string;
  /** Stellar public key of the issuing account. Undefined for native XLM. */
  issuer?: string;
  /** Human-readable name of the issuer / anchor. Undefined for native XLM. */
  issuerName?: string;
  /** True only for native XLM — drives the explicit "Native" badge. */
  isNative?: boolean;
};

export const ASSETS: Asset[] = [
  {
    code: 'XLM',
    isNative: true,
  },
  {
    code: 'USDC',
    issuer: 'GBBD47IF6LWKCNP73SURSF6WKX6NJ3PF7BO5IUXA6J4YWH4BKNW5SXCU',
    issuerName: 'Circle (USDC)',
  },
  {
    code: 'NGN',
    issuer: 'GC2W4XL2LGL6LMEMBNLBE2WV5RDVK7BY6PVSF4DODHD3Q3W5ABZJSA5M',
    issuerName: 'Cowrie MFB (NGN)',
  },
];
