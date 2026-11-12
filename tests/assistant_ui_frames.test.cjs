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
