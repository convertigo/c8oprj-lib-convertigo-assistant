


# ConvertigoAssistant

This is the AI Assistant for Convertigo Performing RAG on OpenAI Apis.

## Symbols


| Symbol    | Usage |
|-----------|-------------------|
|lib_C8Oforms_AI.GPT.apikey.secret  | the openAI Api Key |



For more technical informations : [documentation](./project.md)

- [Installation](#installation)
- [Mobile Application](#mobile-application)
    - [Pages](#pages)
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


## Installation

1. In your Convertigo Studio click on ![](https://github.com/convertigo/convertigo/blob/develop/eclipse-plugin-studio/icons/studio/project_import.gif?raw=true "Import a project in treeview") to import a project in the treeview
2. In the import wizard

   ![](https://github.com/convertigo/convertigo/blob/develop/eclipse-plugin-studio/tomcat/webapps/convertigo/templates/ftl/project_import_wzd.png?raw=true "Import Project")
   
   paste the text below into the `Project remote URL` field:
   <table>
     <tr><td>Usage</td><td>Click the copy button at the end of the line</td></tr>
     <tr><td>To contribute</td><td>

     ```
     ConvertigoAssistant=git@github.com:convertigo/c8oprj-convertigo-assistant.git:branch=master
     ```
     </td></tr>
     <tr><td>To simply use</td><td>

     ```
     ConvertigoAssistant=git@github.com:convertigo/c8oprj-convertigo-assistant/archive/master.zip
     ```
     </td></tr>
    </table>
3. Click the `Finish` button. This will automatically import the __ConvertigoAssistant__ project


## Mobile Application

Describes the mobile application global properties

### Pages

#### Figma

Figma Assistant Page

#### LightRag

IT Support Page

#### Page

AI Component Assistant Page

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
<td>RunQuestion</td><td></td>
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



