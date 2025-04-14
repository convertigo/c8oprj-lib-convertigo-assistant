


# ConvertigoAssitant

This is the AI Assistant for Convertigo Performing RAG on OpenAI Apis.



For more technical informations : [documentation](./project.md)

- [Installation](#installation)
- [Mobile Application](#mobile-application)
    - [Pages](#pages)
        - [Page](#page)
    - [Shared Components](#shared-components)
        - [AssitantMessage](#assitantmessage)
        - [ChatQuestion](#chatquestion)
        - [Markdown](#markdown)
        - [UserMessage](#usermessage)


## Installation

1. In your Convertigo Studio click on ![](https://github.com/convertigo/convertigo/blob/develop/eclipse-plugin-studio/icons/studio/project_import.gif?raw=true "Import a project in treeview") to import a project in the treeview
2. In the import wizard

   ![](https://github.com/convertigo/convertigo/blob/develop/eclipse-plugin-studio/tomcat/webapps/convertigo/templates/ftl/project_import_wzd.png?raw=true "Import Project")
   
   paste the text below into the `Project remote URL` field:
   <table>
     <tr><td>Usage</td><td>Click the copy button at the end of the line</td></tr>
     <tr><td>To contribute</td><td>

     ```
     ConvertigoAssitant=https://github.com/convertigo/c8oprj-convertigo-assitant.git:branch=master
     ```
     </td></tr>
     <tr><td>To simply use</td><td>

     ```
     ConvertigoAssitant=https://github.com/convertigo/c8oprj-convertigo-assitant/archive/master.zip
     ```
     </td></tr>
    </table>
3. Click the `Finish` button. This will automatically import the __ConvertigoAssitant__ project


## Mobile Application

Describes the mobile application global properties

### Pages

#### Page

My First Page as root page

### Shared Components

#### AssitantMessage

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>Text</td><td></td>
</tr>
</table>

#### ChatQuestion

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
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

#### UserMessage

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>Text</td><td></td>
</tr>
</table>



