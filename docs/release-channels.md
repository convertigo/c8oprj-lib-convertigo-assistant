# Stable and preview bundles

The bundle is versioned as a set. Do not independently select the latest release
of each companion project.

| Channel | Assistant | Bridge | MCP |
| --- | --- | --- | --- |
| Stable | 1.5.5 | 0.4.27 | 0.2.27 |
| Preview | 1.5.6-beta.20 | 0.4.28-beta.16 | 0.2.28-beta.15 |

Tigo 1.5.5 integrates personal/team access, the reviewed NoCode branch and the
Claude authentication cache fix (see [release 1.5.5](release-1.5.5.md)). It retains
the Windows credential installation fix from 1.5.4. The preview manifest lists
the pre-releases checked together on the No Code test server; listing them is
the last step of each such set (see
[RELEASING.md](../RELEASING.md#preview-manifest-after-a-checked-pre-release-set)).
The update offer and its channel selector described below are new in the
preview Assistant 1.5.6-beta.17: Studios on the stable 1.5.5 have neither and
read only the stable manifest. Both bundles target Convertigo 8.4.6;
compatibility alone does not constitute stable acceptance.

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
iterations, for example `v1.5.6-beta.1` and `v1.5.6-rc.1`. Keep the preview manifest's three versions
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
