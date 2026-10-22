# Stable and preview bundles

The bundle is versioned as a set. Do not independently select the latest release
of each companion project.

| Channel | Assistant | Bridge | MCP |
| --- | --- | --- | --- |
| Stable | 1.5.3 | 0.4.26 | 0.2.26 |
| Preview | 1.5.3 | 0.4.26 | 0.2.26 |

Tigo 1.5.3 adds the opt-in feedback to Convertigo to the stable bundle (see
[release 1.5.3](release-1.5.3.md); the 1.5 library was promoted in
[release 1.5.2](release-1.5.2.md)). The preview manifest points at the same
bundle until the next preview. Both bundles target Convertigo 8.4.6;
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
manifest's exact CAR URLs or the preview bundle ZIP on GitHub. There is no new
automatic preview subscription or channel selector.

Changing these files does not downgrade projects already installed in a Studio.
To return an existing preview installation to stable, stop active agents and
explicitly reinstall all three stable CARs together. Disable custom MCP
connections before returning to a Bridge that does not manage them. Project
`.tigo/` resources and personal library files are retained; 1.4 does not use them.
Refresh/reopen the Assistant to fetch the stable catalog again.

The existing v1.5.0 tags and CAR bytes are retained as historical preview
artifacts. Their embedded fallback still reflects the original publication;
their normal online manifest now resolves to stable. This correction does not
silently rewrite or retag those CARs.

## Publication and promotion

Pushes build CARs. Tags publish GitHub pre-releases with `make_latest: false`,
including tags without a suffix. Neither event deploys to a Convertigo server.
`[skip deploy]` is no longer needed to prevent deployment. Promoting the
Assistant release to stable deploys it to production (see below).

The explicitly requested `v1.5.1` publication remains a GitHub pre-release despite
its unsuffixed tag. Use beta and release-candidate tags for future preview
iterations, for example `v1.5.4-beta.1` and `v1.5.4-rc.1`. Keep the preview manifest's three versions
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
Pre-releases, previews included, never deploy on their own. A maintainer can
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
