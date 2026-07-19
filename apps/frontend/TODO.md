# AfroPay-Stellar - Frontend Theme + Responsive Fix (TODO)

## Completed

- [x] Enabled Tailwind dark mode via `darkMode: 'class'` in `apps/frontend/tailwind.config.js`.
- [x] Added `apps/frontend/lib/useTheme.ts` hook to persist theme in `localStorage` and toggle `dark` class on `<html>`.
- [x] Added `apps/frontend/components/Header.tsx` with app name, truncated public key display (fallback), and sun/moon theme toggle.
- [x] Updated `apps/frontend/pages/_app.tsx` to render a persistent header and base light/dark page text/background.
- [x] Updated `apps/frontend/pages/index.tsx` to remove hard-coded dark-only classes and make balance grid responsive (`grid-cols-1 sm:grid-cols-3`).
- [x] Updated `apps/frontend/components/SendForm.tsx` to use semantic light/dark paired Tailwind classes for inputs and status text.

## Remaining (verify + polish)

- [ ] Verify there are no remaining `bg-gray-950 text-white` or other dark-only styles in other pages/components (`login.tsx`, `transactions.tsx`, and transaction components).
- [ ] Ensure theme is initialized without flash on first load (optional: add inline script in `_document.tsx` if present).
