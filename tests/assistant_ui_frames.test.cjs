// One frame per surface of the Tigo panel, readable settings tabs, and the Studio web theme: what the checked-in YAML
// generates. node --test tests/assistant_ui_frames.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read } = require('./helpers/assistant-source.cjs');

const page = read('_c8oProject/mobilePages/Page.yaml');
const app = read('_c8oProject/mobileNgxApp.yaml');
const mdReader = read('_c8oProject/mobileSharedComponents/MdReader.yaml');

test('settings: the tab accordion draws no second frame inside the settings surface', () => {
  assert.match(page, /\.agent-config-page \.tigo-settings-categories \{\n\s+border-radius: 0;\n\s+gap: 0;\n\s+padding: 0;\n\s+\}/);
  assert.match(page, /\.agent-config-page \.tigo-settings-categories > ion-accordion \{\n\s+background: transparent;\n\s+border: 0;\n\s+border-radius: 0;\n\s+box-shadow: none;\n\s+\}/);
  // the global accordion style is the one that framed it
  assert.match(app, /ion-accordion \{\n\s+border: 1px solid/);
});

test('settings: tabs on the content, sized by their text, statuses on two lines, two rows when narrow', () => {
  assert.match(page, /\.agent-config-page \.tigo-settings-tabs \{\n\s+display: grid;\n\s+grid-template-columns: repeat\(4, minmax\(0, auto\)\);/);
  assert.match(page, /\.agent-config-page \.tigo-settings-tab \{\n\s+align-items: flex-start;[\s\S]{0,120}border-radius: 8px 8px 0 0;\n\s+margin-bottom: -1px;/);
  assert.match(page, /\.agent-config-page \.tigo-settings-tab-status \{\n\s+-webkit-box-orient: vertical;\n\s+-webkit-line-clamp: 2;/);
  assert.match(page, /@media \(max-width: 639px\) \{\n\s+\.agent-config-page \.tigo-settings-tabs \{\n\s+grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  const label = page.match(/\.agent-config-page \.tigo-settings-tab-label \{[^}]*\}/)[0];
  assert.doesNotMatch(label, /ellipsis|nowrap/, 'a tab label is never cut');
});

test('settings: separators inside the padding, the model refresh on its title line, the runtime title beside its action', () => {
  assert.match(page, /\.agent-setting-section \+ \.agent-setting-section \{\n\s+background-image: linear-gradient\(var\(--tigo-section-line\), var\(--tigo-section-line\)\) !important;\n\s+background-position: center top !important;\n\s+background-size: calc\(100% - 36px\) 1px !important;/);
  assert.match(page, /\.agent-model-setting > ion-button\.agent-model-refresh \{[^}]*top: 8px !important;/);
  assert.match(page, /\.agent-config-page \.agent-runtime-settings > \.agent-create-label \{\n\s+grid-column: 1;/);
  assert.match(page, /:is\(\[value="prompts"\], \[value="skills"\], \[value="mcp"\]\) > \.tigo-accordion-body \{\n\s+padding: 4px 18px 16px;/);
});

test('other surfaces: the home card list, the tool cards and the code blocks keep one frame', () => {
  assert.match(page, /\.agent-start-card \.agent-conversations-panel:not\(\.agent-config-surface\) \{\n\s+background: transparent;\n\s+border-radius: 0;/);
  assert.match(page, /\.agent-worklog-tool > \.agent-worklog-tool-body \{ border-left: 0; border-top: 1px solid/);
  assert.match(mdReader, /markdown pre\[class\*="language-"\] > code\[class\*="language-"\],\n\s+:host ::ng-deep markdown pre > code \{\n\s+background: transparent !important;\n\s+background-image: none !important;\n\s+border: 0 !important;\n\s+border-radius: 0 !important;\n\s+box-shadow: none !important;\n\s+padding: 0 !important;/);
  assert.match(mdReader, /markdown \.markdown-clipboard-button \{[^}]*position: static !important;/);
  for (const scope of [':root.force-light', 'html.force-light', 'body.force-light', '.force-light', 'html:not(.force-dark)']) {
    assert.ok(mdReader.includes(`:host-context(${scope}) ::ng-deep markdown .markdown-clipboard-button`), scope);
  }
});

test('settings in server mode: the notice of the server settings keeps the padding of the sections', () => {
  assert.match(page, /class="tigo-server-scope" role="note" style="margin: 10px 18px 0;/);
  assert.doesNotMatch(page, /class="tigo-server-scope" role="note" style="margin: 6px 2px 12px;/);
});

test('header: compact Reveal and language from 640 px, no logo under 460 px, so the title stays readable in the dock', () => {
  assert.match(page, /@media \(max-width: 640px\) \{\n\s+ion-header\.modern-header ion-buttons \{\n\s+gap: 6px;\n\s+\}\n\s+ion-header\.modern-header ion-button\.toolbar-reveal-button \{\n\s+font-size: 0;/);
  assert.match(page, /@media \(max-width: 460px\) \{\n\s+ion-header\.modern-header \.modern-logo-btn \{\n\s+display: none;/);
  assert.match(app, /html\.tigo-studio-web,\n\s+html\.tigo-studio-web body,\n\s+html\.tigo-studio-web ion-app,/);
});

test('the project subtitle is translated', () => {
  assert.match(page, /return heading\.length \? this\.t\("Agent_Project_Prefix", "Project: "\) \+ heading : "";/);
  assert.doesNotMatch(page, /"Projet : " \+ heading/);
  for (const prefix of ['Project: ', 'Projet : ', 'Progetto: ', 'Proyecto: ']) {
    assert.ok(page.includes(`Agent_Project_Prefix: "${prefix}"`), prefix);
  }
});

test('a failed agent setup gives its reason once, not the generic text twice', () => {
  assert.match(page, /throw new Error\(String\(result\.message \|\| setupError \|\| result\.code \|\| result\.status \|\| ''no reason given''\)\);/);
  assert.match(page, /var setupFailure = \(''''[^\n]*\.replace\(\/\^Error:\\s\*\/, ''''\);/);
});

test('GetVersion names the host from the engine: eclipse, web (a desktop Studio without Studio mode) or server', () => {
  const yaml = read('_c8oProject/sequences/GetVersion.yaml');
  const expression = yaml.match(/↓host \[steps\.ElementStep-\d+\]: \n[\s\S]*?\n  expression: ([^\n]+)\n  nodeName: host/)[1];
  const engines = {
    eclipse: [{ isStudioMode: () => true }, 'eclipse'],
    electron: [{ isStudioMode: () => false, isDesktopStudio: () => true }, 'web'],
    server: [{ isStudioMode: () => false, isDesktopStudio: () => false }, 'server'],
    server84: [{ isStudioMode: () => false }, 'server']
  };
  for (const [kind, [Engine, host]] of Object.entries(engines)) {
    const com = { twinsoft: { convertigo: { engine: { Engine } } } };
    assert.equal(vm.runInNewContext(expression, { com }), host, kind);
  }
});

test('the Studio web theme: only for a web host on the studio surface, the colors of the web Studio, dark and light', () => {
  const theme = app.slice(app.indexOf('Studio web theme'));
  assert.match(app, /var studioSurface = \/\(\?:assistantSurface\|assistantContext\)=studio\(\?:&\|\$\)\/i\.test\(surfaceQuery\);\n\s+if \(studioSurface && noCodeSurface !== true && page\.c8o && page\.c8o\.callJsonObject\) \{\n\s+page\.c8o\.callJsonObject\("lib_ConvertigoAssistant\.GetVersion", \{\}\)/);
  assert.match(app, /var studioWeb = host === "web";[\s\S]{0,200}document\.documentElement\.classList\.toggle\("tigo-studio-web", studioWeb\);/);
  // the variables of the web Studio (StudioShell.svelte, studioTheme.css, convertigo.theme.css)
  for (const [name, dark, light] of [['bg', '#1f1f1f', '#ffffff'], ['line', '#2b2b2b', '#e5e5e5'], ['text', '#cccccc', '#3b3b3b'],
    ['muted', '#858585', '#616161'], ['hover', '#2a2d2e', '#f0f0f0'], ['selection', '#37373d', '#e4e6f1']]) {
    assert.match(theme, new RegExp(`html\\.tigo-studio-web \\{[\\s\\S]*?--tsw-${name}: ${dark};`), name);
    assert.match(theme, new RegExp(`html\\.tigo-studio-web\\.force-light \\{[\\s\\S]*?--tsw-${name}: ${light};`), name);
  }
  assert.match(theme, /--tsw-accent-bg: #18cfff;/);
  assert.match(theme, /--tsw-on-accent: #002f53;/);
  // every rule of the theme is under the class: nothing changes elsewhere (Eclipse, C8Oforms)
  const block = theme.slice(0, theme.indexOf("\n          '"));
  for (const selector of block.match(/^ {10}[^ \n/*-][^\n{]*(?=\s*\{|,\n)/gm) || []) {
    assert.match(selector.trim(), /^html\.tigo-studio-web/, selector);
  }
});

test('the web Studio: the panel shows, read-only, the channel the Studio follows (its preferences), elsewhere unchanged', () => {
  const { ts } = require('./helpers/assistant-source.cjs');
  const start = page.indexOf('        \t// The web Studio installs the agent stack from its own preference');
  const end = page.indexOf('        \tpublic getAgentStackChannelChoice() {');
  assert.ok(start > 0 && end > start);
  const js = ts.transpileModule('class P {\n' + page.slice(start, end) + '\n}', { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText;
  const run = (classes, stored) => {
    const box = {
      document: { documentElement: { classList: { contains: c => classes.includes(c) } } },
      window: { localStorage: { getItem: k => (k === 'convertigo.studio.preferences.v1' ? stored : null) } }
    };
    return new (vm.runInNewContext(js + '\nP;', box))().getWebStudioChannel();
  };
  assert.equal(run(['tigo-studio-web'], JSON.stringify({ assistantChannel: 'preview' })), 'preview');
  assert.equal(run(['tigo-studio-web'], JSON.stringify({ readmeOnSave: true })), 'stable', 'the default of the web Studio');
  assert.equal(run(['tigo-studio-web'], null), 'stable');
  assert.equal(run(['tigo-studio-web'], '{broken'), '', 'unreadable: the panel keeps its own rules');
  assert.equal(run([], JSON.stringify({ assistantChannel: 'preview' })), '', 'the Eclipse Studio, a server: unchanged');
  // it wins, read-only, and the tab status follows it (getAgentStackChannel)
  assert.match(page, /var web = this\.getWebStudioChannel \? this\.getWebStudioChannel\(\) : "";\n\s+if \(web\) \{ return web; \}\n\s+var choice = this\.isAgentStackChannelFixed\(\)/);
  assert.match(page, /if \(this\.isAgentStackChannelFixed\(\) \|\| \(this\.getWebStudioChannel && this\.getWebStudioChannel\(\)\)\) \{ return; \}/);
  assert.match(page, /if \(web\) \{\n[^\n]*\n\s+view = \{\n\s+readOnly: true, channel: web,[^\n]*\n[^\n]*\n\s+hint: this\.agentStackOfferText\("webStudioChannel"\)/);
  assert.equal((page.match(/webStudioChannel: "[^"]+Releases of the local Assistant[^"]+"/g) || []).length, 4, 'en, fr, it, es');
  assert.match(page, /\{\{agentStackOfferText\(getAgentStackChannel\(\) === ''preview'' \? ''channelPreview'' : ''channelStable''\)\}\}/);
});

test('Runtime and stack: an error or a refusal keeps its alert color in the dark theme', () => {
  assert.match(page, /\(this\.local\.AgentRuntimeError \|\| \(this\.local\.AgentRuntimeProvider === ''convertigo'' && this\.getConvertigoAccessRefusalText && this\.getConvertigoAccessRefusalText\(\)\)\)\) \? ''agent-runtime-status error''/);
  assert.match(page, /:host-context\(\.force-dark\) \.agent-runtime-status\.error \{\n\s+color: #f87171;/);
  assert.match(page, /:host-context\(body:not\(\.force-light\)\) \.agent-runtime-status\.error \{\n\s+color: #f87171;/);
  assert.match(page, /\.agent-runtime-status\.error \{\n\s+color: #b42318;/);
});

test('header: the project subtitle stays readable in the dock (whole title width, two lines)', () => {
  assert.match(page, /ion-header\.modern-header \.modern-title-sub\.modern-title-sub-project \{\n\s+-webkit-box-orient: vertical;\n\s+-webkit-line-clamp: 2;\n\s+display: -webkit-box !important;[\s\S]{0,240}overflow-wrap: anywhere;\n\s+white-space: normal;/);
  assert.doesNotMatch(page, /modern-title-sub-project \{\n\s+display: block !important;[\s\S]{0,140}white-space: nowrap;/);
  assert.match(page, /ion-header\.modern-header ion-title \{\n\s+padding-left: 6px;\n\s+padding-right: 6px;\n\s+\}\n\s+ion-header\.modern-header \.modern-title-wrap \{\n\s+height: auto;\n\s+min-height: 34px;\n\s+width: 100%;/);
});

test('the Studio web theme paints the round Reveal button, never a square behind it', () => {
  const rule = app.match(/html\.tigo-studio-web ion-header ion-button\.toolbar-reveal-button \{[^}]*\}/)[0];
  assert.match(rule, /--background: var\(--tsw-control\) !important;/);
  assert.match(rule, /background: transparent !important;/);
  assert.doesNotMatch(rule, /\n\s+(background|border-color): var\(--tsw-control/);
  assert.match(app, /html\.tigo-studio-web ion-header ion-select\.toolbar-lang-select \{\n\s+--background: var\(--tsw-control\) !important;/);
});

test('the Studio web theme also sets the Ionic colors: the side menu and the Usage window leave the old navy', () => {
  // The dark palette sets them on :root.force-dark and on body, ion-app, ion-content and ion-menu, which outrank
  // html.tigo-studio-web: the theme sets them on the same elements, with !important, from the Studio variables.
  const tokens = app.match(/ {10}html\.tigo-studio-web,\n\s+html\.tigo-studio-web body,\n\s+html\.tigo-studio-web ion-app,\n\s+html\.tigo-studio-web ion-content,\n\s+html\.tigo-studio-web ion-menu,\n\s+html\.tigo-studio-web ion-popover,\n\s+html\.tigo-studio-web ion-modal \{[^}]*\}/)[0];
  for (const [name, value] of [['background-color', 'bg'], ['background-color-rgb', 'bg-rgb'], ['text-color', 'text'], ['text-color-rgb', 'text-rgb'],
    ['border-color', 'line'], ['item-background', 'card'], ['card-background', 'card'], ['toolbar-background', 'chrome'],
    ['color-primary', 'accent'], ['color-primary-rgb', 'accent-rgb'], ['color-medium', 'muted']]) {
    assert.match(tokens, new RegExp(`--ion-${name}: var\\(--tsw-${value}\\) !important;`), name);
  }
  for (const [name, dark, light] of [['bg-rgb', '31, 31, 31', '255, 255, 255'], ['text-rgb', '204, 204, 204', '59, 59, 59'], ['accent-rgb', '24, 207, 255', '7, 158, 204']]) {
    assert.match(app, new RegExp(`html\\.tigo-studio-web \\{\\n\\s+(?=--tsw-bg-rgb)[^}]*?--tsw-${name}: ${dark};`), name);
    assert.match(app, new RegExp(`html\\.tigo-studio-web\\.force-light \\{\\n\\s+(?=--tsw-bg-rgb)[^}]*?--tsw-${name}: ${light};`), name);
  }
  // the menu: flat chrome over its fixed navy container (#0f172a under :root.force-dark)
  assert.match(app, /html\.tigo-studio-web:root ion-menu::part\(container\) \{\n\s+background-color: var\(--tsw-chrome\) !important;/);
  assert.match(app, /html\.tigo-studio-web ion-menu ion-content::part\(background\),\n\s+html\.tigo-studio-web ion-menu ion-footer \{\n\s+--background: var\(--tsw-chrome\) !important;\n\s+background: var\(--tsw-chrome\) !important;/);
  assert.match(app, /html\.tigo-studio-web ion-menu ion-item\.selected::part\(native\) \{\n\s+background: var\(--tsw-selection\) !important;/);
  // the Usage window
  assert.match(app, /html\.tigo-studio-web \.agent-quota-popover \{\n\s+--background: var\(--tsw-chrome\) !important;/);
  assert.match(read('_c8oProject/mobileSharedComponents/LightRagFooterComponent.yaml'), /\.agent-quota-popover \{ [^}]*--background:var\(--ion-background-color,#fff\);/);
});
