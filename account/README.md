# Shared sign-in across joe.mt subdomains

`/account/` stores the PocketBase `users` session in a JavaScript-readable cookie
with `Domain=joe.mt`, `Path=/`, `Secure`, and `SameSite=Lax`. That lets apps on
`joe.mt`, `notes.joe.mt`, and other `*.joe.mt` hosts read the same session. Sign-out
removes the shared cookie. The auth store also imports an existing `users`
session from PocketBase's `pocketbase_auth` localStorage key once.

Apps on other subdomains must use the shared store when creating their
PocketBase client. For example, in the `notes.joe.mt` app:

```html
<script src="https://cdn.jsdelivr.net/npm/pocketbase/dist/pocketbase.umd.js"></script>
<script src="https://joe.mt/account/shared-auth.js"></script>
<script>
  const pb = new PocketBase(
    'https://joemt.fly.dev',
    new JoeSharedAuth.Store()
  );

  function signIn() {
    location.href = 'https://joe.mt/account/?redirect=' + encodeURIComponent(location.href);
  }

  function signOut() {
    pb.authStore.clear();
  }
</script>
```

Create the client before checking `pb.authStore.isValid`. If an already open
tab regains focus, the store rereads the cookie and fires its `onChange`
listeners when another subdomain changed the session. Apps with a visible
signed-in state should listen for those changes and update their UI.

The cookie is available to JavaScript on every `joe.mt` subdomain, as required
by a static frontend sharing a PocketBase token. Only use this with subdomains
you control. PocketBase still validates the token on API requests.
