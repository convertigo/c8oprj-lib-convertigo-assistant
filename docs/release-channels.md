# Stable and preview bundles

The bundle is versioned as a set. Do not independently select the latest release
of each companion project.

| Channel | Assistant | Bridge | MCP |
| --- | --- | --- | --- |
| Stable | 1.5.6 | 0.4.28 | 0.2.28 |
| Preview | 1.5.7-beta.7 | 0.4.29-beta.10 | 0.2.29-beta.18 |

Tigo 1.5.6 adds the Studio update offer and its channel selector, the No Code
sandbox, faster No Code starts, preview capture and Baserow row reads (see
[release 1.5.6](release-1.5.6.md)). It retains personal/team access and the NoCode
integration from [1.5.5](release-1.5.5.md). The preview manifest lists the
pre-releases checked together on the No Code test server; listing them is the
last step of each such set (see
[RELEASING.md](../RELEASING.md#preview-manifest-after-a-checked-pre-release-set)).
Studios still on 1.5.5 have no update card and read only the stable manifest:
they find 1.5.6 in the stack settings of the panel. Both bundles target
Convertigo 8.4.6; compatibility alone does not constitute stable acceptance.

## Manifests and existing Studios

- `stack-release-stable.json` is the reviewed default bundle.
- `stack-release-preview.json` is an explicit opt-in catalog for testers.
- `stack-release.json` is a compatibility alias with exactly the same content
  as the stable manifest. Existing published Assistants fetch this path from
  `master`, so it must never point to the preview bundle.

The current source's `AgentStackRelease.GetManifest` reads the canonical stable
file. Its embedded frontend fallback also pins the stable bundle, and a preview
response cannot replace that fallback. New builds expose
`AgentStackRelease.GetPreviewManifest` for an explicit preview read; the default
installation/update path does not call it. Testers can already use the preview
manifest's exact CAR URLs or the preview bundle ZIP on GitHub. In a Studio, the
stack settings of the Assistant panel also choose the update channel (below).

Changing these files does not downgrade projects already installed in a Studio.
To return an existing preview installation to stable, stop active agents and
explicitly reinstall all three stable CARs together. Disable custom MCP
connections before returning to a Bridge that does not manage them. Project
`.tigo/` resources and personal library files are retained; 1.4 does not use them.
Refresh/reopen the Assistant to fetch the stable catalog again.

A Studio is offered each new release of its update channel: its Assistant panel
reads the manifests at most once a day and, when they are newer than the
installed projects, shows a card with the versions concerned, "Update" and
"Later". "Update" installs only the projects older than the offered release,
never while a turn runs; a pre-release newer than the stable one is kept. Git
checkouts and `assistant.stack.selfupdate=false` turn the update off with a
reason. Servers, No Code included, are never offered it: they update from their
settings.

The channel is chosen in the stack settings of the panel, per Studio:

- **Stable** (default): `stack-release-stable.json` only.
- **Pre-releases**: per project, the higher of `stack-release-stable.json` and
  `stack-release-preview.json`, so a newer stable still comes. Pre-releases reach
  this channel only through the preview manifest on `master` (see RELEASING.md).
  Going back to Stable downgrades nothing: the next newer stable is offered.

### Server channel: `assistant.stack.channel`

The global symbol `assistant.stack.channel` sets the update channel of a whole
Convertigo server: `stable` (the default, also when the symbol is empty or holds
another value) or `preview`. Its administrator sets it once for every user, which
a browser setting cannot do. `AgentStackStatus` returns it
(`localAgentStackChannel`, and `localAgentStackChannelSource`: `symbol` or
`default`).

- On a server, No Code included, the stack settings of the Assistant panel show
  the versions of that channel: on `preview`, per project the higher of the
  stable and preview manifests, as in a Studio. The channel is shown read-only,
  with the symbol name. Users that `assistant.stack.selfupdate` allows can update
  from there. A server is still never offered the update card.
- In a Studio, the symbol gives the default channel until a channel is chosen in
  the panel; that choice, kept by the Studio, then takes precedence. The stack
  settings follow the same channel as the card.
- A manifest that cannot be read leaves the stable versions.
- The channel never limits `AgentStackInstall`: an official release CAR can still
  be installed by its URL when no manifest lists it, which is how a beta is checked
  on a test server before the preview manifest lists it.
  `assistant.stack.selfupdate` and the official-CAR allow-list still apply.

The existing v1.5.0 tags and CAR bytes are retained as historical preview
artifacts. Their embedded fallback still reflects the original publication;
their normal online manifest now resolves to stable. This correction does not
silently rewrite or retag those CARs.

## Publication and promotion

Pushes build CARs. Tags publish GitHub pre-releases with `make_latest: false`,
including tags without a suffix. Neither event deploys to a Convertigo server.
`[skip deploy]` is no longer needed to prevent deployment. Promoting the
Assistant release to stable normally deploys it to production (see below). A
release body containing `[skip deploy]` suppresses this automatic deployment.

The explicitly requested `v1.5.1` publication remains a GitHub pre-release despite
its unsuffixed tag. Use beta and release-candidate tags for future preview
iterations, for example `v1.5.7-beta.1` and `v1.5.7-rc.1`. Keep the preview manifest's three versions
coherent with its published CARs.

Stable promotion is an explicit maintainer operation after code review and
agreed functional acceptance: update the stable manifest, compatibility alias
and frontend fallback together, then mark the corresponding three GitHub
releases as non-prereleases/Latest. Update this table at the same time. A
successful build does not promote or deploy a release.

## Hosted deployment

Only the Assistant repository has the **Deploy published Assistant release**
workflow. It runs by itself for production when an Assistant release becomes
stable: a release published as stable, or a pre-release marked as a release
(the GitHub `released` event, as with `gh release edit --prerelease=false`).
Pre-releases, previews included, never deploy on their own. Releases whose body
contains `[skip deploy]` also never deploy automatically; 1.5.4 uses this explicit
exception so it can be distributed to Studio users before hosted deployment.
The marker may be placed in an HTML comment. A maintainer can
also start it with `workflow_dispatch`, select an existing release tag and choose
`development` or `production`, for instance to deploy a release again.

The workflow downloads the published CAR and verifies its GitHub SHA-256 digest,
project identity and version. Production additionally requires the Assistant tag
from the stable manifest and a GitHub release that is not a pre-release. It
deploys that verified CAR without loading/rebuilding the current source branch.

Development uses `C8O_SERVER`, `C8O_USER`, `C8O_PASSWORD`; production uses the
corresponding `_PROD` secrets. Missing production secrets fail rather than fall
back to development credentials. TLS certificate verification stays enabled.
The workflow uses the selected GitHub environment; its environment protection
rules apply when configured.

For assistant.convertigo.com, backend-apps hosts only the Assistant frontend.
Bridge and MCP are installed in Studio, and their CI has no server-deployment
workflow. Agent execution on a separate NoCode server is a distinct installation.

Local verification:

```sh
node --test tests/assistant_stack_ui.test.cjs
python3 -m unittest discover -s tests -p 'release_deployment_test.py'
```
