<p align="center">
  <img src="assets/tigo-head.png" alt="Tigo" width="220">
</p>

# Tigo, the Convertigo agent

Tigo brings a local AI agent into Convertigo Studio. It connects OpenAI Codex
or Mistral Vibe to the current workspace through Convertigo MCP and the
Convertigo Agent Bridge.

Tigo can inspect and modify Convertigo projects, run backend requests, open NGX
viewers, validate visible behavior, and reveal changes in Studio while the agent
works.

## Highlights

- Works from the Convertigo Assistant view with project-aware conversations.
- Supports OpenAI Codex and Mistral Vibe with workspace-managed CLI runtimes.
- Uses Convertigo MCP for structured project discovery, editing, and validation.
- Uses the Agent Bridge for local conversations, credentials, runtime setup, and
  long-running agent processes.
- Provides Reveal mode so supported MCP operations can select changed objects
  and open the relevant Studio or viewer surface.
- Keeps conversations and managed agent homes inside the Convertigo workspace.

## Requirements

<<<<<<< HEAD
| Symbol    | Usage |
|-----------|-------------------|
|lib_C8Oforms_AI.GPT.apikey.secret  | the openAI Api Key |



For more technical informations : [documentation](./project.md)

- [Installation](#installation)
- [Mobile Application](#mobile-application)
    - [Pages](#pages)
        - [Agent](#agent)
        - [Figma](#figma)
        - [LightRag](#lightrag)
        - [Page](#page)
    - [Shared Components](#shared-components)
        - [AssistantMessageComponent](#assistantmessagecomponent)
        - [FigmaFooterComponent](#figmafootercomponent)
        - [LightRagFooterComponent](#lightragfootercomponent)
        - [Markdown](#markdown)
        - [MdReader](#mdreader)
        - [UserMessageComponent](#usermessagecomponent)

=======
- Convertigo Studio 8.4.4 or newer for the local Agent onboarding flow.
- Network access to the selected agent provider and package registries. Studio
  proxy settings are propagated to managed runtime downloads and processes.
- Provider credentials for OpenAI Codex or Mistral Vibe.
>>>>>>> branch 'codex/assistant-agent-bridge' of git@github.com:convertigo/c8oprj-convertigo-assistant.git

## Installation

Open the **Convertigo Assistant** view in Convertigo Studio. When the local Agent
stack is missing, Tigo offers to install the three required projects:

1. `ConvertigoAssistant`
2. `ConvertigoMCP`
3. `ConvertigoAgentBridge`

<<<<<<< HEAD
     ```
     ConvertigoAssistant=git@github.com:convertigo/c8oprj-convertigo-assistant.git:branch=codex/assistant-agent-bridge
     ```
     </td></tr>
     <tr><td>To simply use</td><td>
=======
The one-click flow imports the release packages, switches the Assistant view to
the local relative URL, and reloads it. Tigo then guides the user through agent
selection and workspace-local CLI setup.
>>>>>>> branch 'codex/assistant-agent-bridge' of git@github.com:convertigo/c8oprj-convertigo-assistant.git

<<<<<<< HEAD
     ```
     ConvertigoAssistant=git@github.com:convertigo/c8oprj-convertigo-assistant/archive/codex/assistant-agent-bridge.zip
     ```
     </td></tr>
    </table>
3. Click the `Finish` button. This will automatically import the __ConvertigoAssistant__ project
=======
The companion projects are maintained separately:
>>>>>>> branch 'codex/assistant-agent-bridge' of git@github.com:convertigo/c8oprj-convertigo-assistant.git

- [Convertigo MCP](https://github.com/convertigo/c8oprj-c8o-mcp)
- [Convertigo Agent Bridge](https://github.com/convertigo/c8oprj-convertigo-agent-bridge)

## Updating

Agent CLI versions are checked from the Tigo configuration page and cached for
six hours. Updating the three Convertigo projects is a separate stack operation:
the installed project versions must be compared with the selected release
channel before importing newer `.car` packages.

## Development

<<<<<<< HEAD
#### Agent

Agent AI entry page

#### Figma
=======
Import the active development branch with:
>>>>>>> branch 'codex/assistant-agent-bridge' of git@github.com:convertigo/c8oprj-convertigo-assistant.git

```text
ConvertigoAssistant=https://github.com/convertigo/c8oprj-convertigo-assistant.git:branch=codex/assistant-agent-bridge
```

<<<<<<< HEAD
#### LightRag

IT Support Page

#### Page

Convertigo Assistant Page

### Shared Components

#### AssistantMessageComponent

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>author</td><td></td>
</tr>
<tr>
<td>file</td><td></td>
</tr>
<tr>
<td>files</td><td></td>
</tr>
<tr>
<td>message</td><td></td>
</tr>
<tr>
<td>rawStreamTicker</td><td></td>
</tr>
<tr>
<td>status</td><td></td>
</tr>
<tr>
<td>tag1</td><td></td>
</tr>
<tr>
<td>tag2</td><td></td>
</tr>
<tr>
<td>tag3</td><td></td>
</tr>
<tr>
<td>time</td><td></td>
</tr>
<tr>
<td>writing</td><td></td>
</tr>
</table>

#### FigmaFooterComponent

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>EnableChat</td><td></td>
</tr>
<tr>
<td>Files</td><td></td>
</tr>
<tr>
<td>IsProcessing</td><td></td>
</tr>
<tr>
<td>Question</td><td></td>
</tr>
</table>

**events**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>RunQuestion</td><td></td>
</tr>
</table>

#### LightRagFooterComponent

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>AgentModel</td><td></td>
</tr>
<tr>
<td>AgentModelLabel</td><td></td>
</tr>
<tr>
<td>AgentModels</td><td></td>
</tr>
<tr>
<td>AgentReasoningEffort</td><td></td>
</tr>
<tr>
<td>AgentReasoningLabel</td><td></td>
</tr>
<tr>
<td>AgentReasoningLevels</td><td></td>
</tr>
<tr>
<td>EnableAssetInputs</td><td></td>
</tr>
<tr>
<td>EnableAttachmentInputs</td><td></td>
</tr>
<tr>
<td>EnableChat</td><td></td>
</tr>
<tr>
<td>IsProcessing</td><td></td>
</tr>
<tr>
<td>Placeholder</td><td></td>
</tr>
<tr>
<td>Question</td><td></td>
</tr>
<tr>
<td>SpeechRecognitionAvailable</td><td></td>
</tr>
<tr>
<td>Suggestions</td><td></td>
</tr>
</table>

**events**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>ModelChange</td><td></td>
</tr>
<tr>
<td>ReasoningChange</td><td></td>
</tr>
<tr>
<td>RunQuestion</td><td></td>
</tr>
<tr>
<td>StopRequest</td><td></td>
</tr>
<tr>
<td>VoiceRequest</td><td></td>
</tr>
</table>

#### Markdown

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>data</td><td></td>
</tr>
</table>

**events**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>ready</td><td></td>
</tr>
</table>

#### MdReader

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>data</td><td></td>
</tr>
</table>

**events**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>ready</td><td></td>
</tr>
</table>

#### UserMessageComponent

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>author</td><td></td>
</tr>
<tr>
<td>message</td><td></td>
</tr>
<tr>
<td>time</td><td></td>
</tr>
</table>



=======
Convertigo project objects must be edited through Convertigo Studio or the
Convertigo MCP tools. Generated mobile sources under `_private` and
`DisplayObjects` are build outputs.
>>>>>>> branch 'codex/assistant-agent-bridge' of git@github.com:convertigo/c8oprj-convertigo-assistant.git
