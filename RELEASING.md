# Releasing the Tigo agent stack

The stack is three Convertigo projects released independently and tied together by one
manifest owned by this repository:

| Project | Repository | Default branch |
| --- | --- | --- |
| `lib_ConvertigoMCP` | `convertigo/c8oprj-lib-c8o-mcp` | `main` |
| `lib_ConvertigoAgentBridge` | `convertigo/c8oprj-lib-convertigo-agent-bridge` | `main` |
| `lib_ConvertigoAssistant` | `convertigo/c8oprj-lib-convertigo-assistant` | `master` |

## What the manifest is

`stack-release.json` on `master` of this repository is the **public** manifest. Every
installed Assistant reads it (through the `AgentStackRelease.GetManifest` transaction, from
`raw.githubusercontent.com`) to decide which versions to install or update. Pushing `master`
therefore publishes the stack to every user at once.

The same three entries are **embedded** in `_c8oProject/mobilePages/Page.yaml`
(`getEmbeddedAgentStackRelease`). The embedded copy is the fallback when the public manifest
cannot be fetched, and the first install of a fresh Studio uses it. Both copies must always
carry the same versions, tags and `importUrl`.

Each `importUrl` points at a release CAR:
`<project>=https://github.com/convertigo/<repository>/releases/download/v<version>/<project>.car`

## Hosting assistant.convertigo.com on backend-apps

Deploy only `lib_ConvertigoAssistant` on `backend-apps.convertigo.net` to serve
`assistant.convertigo.com`. Neither `lib_ConvertigoAgentBridge` nor
`lib_ConvertigoMCP` needs to be installed on that hosting server. Publishing their
release CARs for the Studio bundle does not mean deploying them on backend-apps.

The three-project bundle remains necessary in the developer's Studio: the Bridge
executes the local agents and MCP exposes the local Convertigo tools. Verify real
wrapper quotas in that Studio context. A standalone public Assistant page does
not provide access to the developer's local harness session.

A separate server/NoCode installation that executes agents needs its own full
stack on the execution server. This is distinct from backend-apps serving the
public frontend. TigoAccess remains a separate hosted backend service.

## Release order

Dependencies first, the Assistant last, because its manifest references the two others.

1. **MCP**, if it changed.
2. **Agent Bridge**, if it changed.
3. **Assistant**, always: it carries the manifest, even when only MCP or the Bridge changed.

For each project:

1. `git fetch --tags` and look at the latest tag first. Several people release; never reuse
   a version number, take the next one.
2. Bump `version:` in `c8oProject.yaml`.
3. Run the tests (see below).
4. Commit as `Release X.Y.Z: <what changed>`, tag `vX.Y.Z`.
5. Push the **tag** (and the branch for MCP and the Bridge). GitHub Actions builds the CAR
   and attaches it to the GitHub release of that tag.
6. Wait until the CAR asset exists on the release before going further.

For the Assistant, additionally:

- update the three entries in `stack-release.json` **and** in the embedded copy in
  `Page.yaml`, including the Assistant's own new version;
- update the pinned versions in `tests/assistant_routing.test.js`;
- push the tag first and **push `master` only once the three CARs referenced by the manifest
  exist**. Pushing `master` earlier publishes a manifest whose `importUrl` returns 404, and
  every stack update fails until the build finishes.

Studios on the **Pre-releases** channel are offered a stack pre-release only once
`stack-release-preview.json` on `master` lists it. To offer one, after its three CARs exist and
were checked together, set the three entries of that file (name, version, `tag` `vX.Y.Z-beta.N`,
official `importUrl`) and update the preview versions pinned in `tests/assistant_stack_ui.test.cjs`.
Never list a version older than the stable manifest; at a stable release, set it to the stable
bundle as before. A preview never deploys and never reaches the Stable channel.

Tags publish GitHub pre-releases (see [release channels](docs/release-channels.md)). A stable
release is promoted once `master` carries its manifests: mark the three releases as non-prerelease
and Latest (`gh release edit vX.Y.Z --prerelease=false --latest`). Promoting the Assistant release
deploys it to production through the **Deploy published Assistant release** workflow; a preview
stays a pre-release and is never deployed.

After pushing `master`, check the published manifest and that the three URLs answer 200:

```bash
curl -s https://raw.githubusercontent.com/convertigo/c8oprj-lib-convertigo-assistant/refs/heads/master/stack-release.json
```

## Preview manifest after a checked pre-release set

Since Assistant 1.5.6 (Studios still on 1.5.5 have no update offer), the Assistant panel of a
Studio offers stack updates from its update channel: Stable by default, or Pre-releases, which
adds what `stack-release-preview.json` on `master` lists. Nothing updates
that file on its own, and releasing an MCP or Bridge beta never touches this repository.

So when a set of pre-releases has been installed and checked together on test-nocode (the No
Code test server), its last step, whichever projects changed, is one commit on `master` of this
repository that:

1. sets the three entries of `stack-release-preview.json`: name, version, `tag`
   `vX.Y.Z-beta.N` and the official `importUrl` of the release CAR (format above);
2. updates the preview versions pinned in `tests/assistant_stack_ui.test.cjs`, then runs
   `node --test tests/assistant_stack_ui.test.cjs`;
3. updates the Preview row of [release channels](docs/release-channels.md).

List only a set checked together, and never a version older than the stable manifest. Leave
the stable manifest untouched (`stack-release-stable.json`, its alias `stack-release.json` and
the fallback in `Page.yaml`). After the push, check the published preview manifest and that its
three URLs answer 200:

```bash
curl -s https://raw.githubusercontent.com/convertigo/c8oprj-lib-convertigo-assistant/refs/heads/master/stack-release-preview.json
```

## Tests

- Before tagging any of the three projects, load it exactly as the CI does: `sh gradlew -q load`.
  It catches what the Node tests cannot: a malformed bean header (Convertigo YAML needs a space
  after a trailing colon, `]: `), a duplicated bean id, an undefined symbol. A tag whose build
  fails is burnt: take the next version number.
- Assistant: `for t in tests/*.test.js tests/*.test.cjs; do node --test "$t"; done`
  (they read the checked-in YAML, not a Mobile Builder output).
- Agent Bridge: `for t in tests/*.test.js; do node --test "$t"; done`
- MCP: the `tests/scripts/validate_*.js|cjs` scripts. `validate_nocode_generation.cjs` needs
  the sibling `C8oForms` project checked out next to the repository.

YAML pitfalls when editing `Page.yaml` by hand: TypeScript lives inside single-quoted YAML
scalars, so a quote is written `''`; comments containing `: ` must be quoted.
`readme.md` and `project.md` of MCP and the Bridge are generated by Studio from bean
comments; document behaviour in the `comment:` of the sequence or variable, not in those files.

## How installations pick the release up

- **Studio**: the stack panel compares installed versions with the manifest and the Studio
  host imports the CARs. Projects that are Git checkouts are never replaced.
- **Agent execution server** (No Code Studio, C8Oforms, explicit server-agent integration): the same button runs the
  `AgentStackInstall` sequence, in the order MCP, Bridge, Assistant, then reloads the page.
  Access is controlled by the global symbol `assistant.stack.selfupdate`
  (`admin` by default, `authenticated`, `true`, `false`); see `readme.md`.
  This does not apply to backend-apps merely hosting `assistant.convertigo.com`.
- Only official release CARs of the three repositories are accepted, whatever a client sends.

## Rolling back

Re-point the manifest entry (both copies) at the previous tag and release a new Assistant
version. Do not delete or move a published tag: installed stacks compare version numbers and
will not downgrade on their own, so a rollback needs a **higher** version that carries the fix
or the revert.
