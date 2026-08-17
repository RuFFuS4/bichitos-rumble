// Build-time constants injected by vite.config.ts `define`.
// __BUILD_COMMIT__ — short git sha of the build, used as the Sentry
// release id (see src/observability.ts). 'dev' outside a git checkout.
declare const __BUILD_COMMIT__: string;
