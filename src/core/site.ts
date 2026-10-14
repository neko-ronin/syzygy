/**
 * Which site this bundle is.
 *
 * True in `vite build --mode web`, the static Cloudflare deploy. There is no dev
 * server there, so no `/api/*`, no key and no capture harness: the public build
 * drops the conductor, the debug HUD and the automation surface, and runs the
 * showcase clock. Vite inlines `MODE` as a string literal, so every branch on
 * this folds away at build time and the dropped code leaves the bundle.
 */
export const STATIC_SITE = import.meta.env.MODE === 'web';
