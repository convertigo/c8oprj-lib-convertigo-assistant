# No Code server settings

Administrators save the No Code agent settings from this server's settings page.
Saves use POST. A request containing an Origin header must match the server's
origin, including scheme and port, even when a session token is supplied.
A client without an Origin header must supply the existing engine session token
using X-Xsrf-Token or __xsrfToken. Token acquisition is a separate step; Fetch is
not an established session token. Reads retain their existing behavior.

## Public endpoint behind an ingress

When an ingress terminates TLS, configure **Convertigo Server local URL**
(`application_server.convertigo.url`) to the **public HTTPS Convertigo URL**, for
example `https://studio.example.test/convertigo`. This setting is the primary URL
used by the settings request check; an internal HTTP service URL does not identify
the public browser origin. The endpoint URL setting is used only when the primary
URL is empty.

With a browser Origin of `https://studio.example.test` and an internal request URL
of `http://engine:28080/convertigo`, a missing or incorrect public URL refuses the
browser's settings saves, including requests carrying a session token. Configure
the public URL correctly and retry from the settings page. Do not change global
request checks to accommodate an internal URL.

Verify the public scheme, hostname and port after ingress or endpoint changes.
The same rules apply to implicit administrator preference saves.
