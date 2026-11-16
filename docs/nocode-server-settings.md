# No Code server settings

Administrators save the No Code agent settings from this server's settings page.
Saves use POST. A request containing an Origin header must match the server's
origin, including scheme and port, even when a session token is supplied.
A client without an Origin header must supply the existing engine session token
using X-Xsrf-Token or __xsrfToken. Token acquisition is a separate step; Fetch is
not an established session token. Reads retain their existing behavior.

A supplied token is checked against the token the engine issued to the session.
When the session holds none, the token proves nothing and the Origin decides, as
for Fetch. The c8o SDK of the Tigo panel sends the `x-xsrf-token` its origin keeps
in localStorage, a key the engine's administration console writes for its own
sessions, while the engine issues no token to a No Code session (API calls and
user services answer none). Before this rule, every save of a No Code
administrator who had once opened the console in that browser was refused with
`request_token_required` (test-nocode, Assistant 1.6.0-beta.18 to beta.30): the
model chosen in the Agent tab never reached the server. A refused save now keeps
the settings screen open and says why.

## The effort of each user

The administrators set the agent, the model and the default effort. Each user
sees the agent and the model (composer and settings, read only) and chooses their
own effort among the levels of that model: `AgentServerSettings` with
`action=reasoning` and `settings={"reasoning":"low"}` (empty goes back to the
server default), with the same POST and request checks, for the user of the
session with the Tigo right. The level is checked against the model's levels as
the Bridge offers them (its cached catalog). It is kept in
`agents/nocode/users/<userKey>/reasoning.json` with the agent and the model it was
chosen for, and applies while the server runs them: after the administrators
change either, the user is back on the server default until they choose again.

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
