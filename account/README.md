# Account sign-in

The sign-in UI and session live at `https://accounts.joe.mt/` in the
`ignore-me-its-just-internal-multiverse-accounts-thing` repository. This
`/account/` page only redirects old links there, preserving their query string.

Apps use `https://accounts.joe.mt/client.js` to request an account session from
the accounts-origin bridge. The bridge returns the PocketBase token to exact
allowed origins through a nonce-checked `postMessage` exchange. The token is
never included in the redirect URL, and no cookie is shared across subdomains.

Deploy the accounts site first, then JNote, then this site. That order keeps
the old JNote deployment working until it no longer loads `/account/shared-auth.js`.
