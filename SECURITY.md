# Security policy

OpenMorph processes files entirely in the browser. The most important property to protect is that **user files never leave the device**.

## Reporting a vulnerability

Please report privately through [GitHub Security Advisories](https://github.com/xeej0/openmorph/security/advisories/new) rather than a public issue. Include steps to reproduce and the browser you used. You should get a reply within a week.

Especially interesting:
- any way for page content to send file data to another origin
- script injection through file names, file contents or URL parameters
- weaknesses in the Content Security Policy in `vercel.json`

## What is in place

- Static site, no backend, no cookies, no analytics, no third-party scripts or CDNs.
- Content Security Policy with `connect-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'none'`, `base-uri 'none'`.
- `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (camera, microphone, location off), `Cross-Origin-Opener-Policy`, HSTS (from Vercel).
- File names are HTML-escaped before display; tool output is shown with `textContent`.
- Dependencies pinned with a lockfile, updated by Dependabot, checked with `npm audit` in CI.
- The end-to-end test fails if the page requests anything from another origin or violates the CSP.

Known trade-off: `script-src` includes `'unsafe-eval'` because the HEIC decoder (heic2any, an asm.js build of libheif) requires it.
