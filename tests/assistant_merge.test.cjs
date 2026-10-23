// Offline merge checks: no Studio reload, filesystem mutation or remote requests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ts, read, formattedEntries, blockWith, pageClass } = require('./helpers/assistant-source.cjs');
const root = path.resolve(__dirname, '..');
const pageFile = '_c8oProject/mobilePages/Page.yaml';
function files(dir) {
  return fs.readdirSync(path.join(root, dir), {withFileTypes:true}).flatMap(e => e.isDirectory() ? files(dir + '/' + e.name) : [dir + '/' + e.name]);
}
function syntax(source, label) {
  const parsed = ts.createSourceFile(label + '.ts', source, ts.ScriptTarget.Latest, true);
  assert.deepEqual(parsed.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], label);
}

test('merged Convertigo objects have unique priorities and no unresolved markers', () => {
  const seen = new Map();
  for (const file of ['c8oProject.yaml', ...files('_c8oProject').filter(f => f.endsWith('.yaml'))]) {
    const source = read(file);
    assert.doesNotMatch(source, /^(<<<<<<<|=======|>>>>>>>)/m, file);
    for (const match of source.matchAll(/^ *↓.*\[[^\]]+-(\d{6,})\]:/gm)) {
      assert.equal(seen.has(match[1]), false, file + ' duplicates ' + seen.get(match[1]));
      seen.set(match[1], file);
    }
  }
});

test('merged page scripts and action blocks remain syntactically valid TypeScript', () => {
  syntax(pageClass(), 'Page functions');
  let count = 0;
  for (const file of [pageFile, '_c8oProject/mobileSharedActions/ApplyNoCodeAssistantCatalog.yaml', '_c8oProject/mobileSharedActions/SelectNoCodeAssistantTarget.yaml']) {
    for (const entry of formattedEntries(file).filter(e => /actionValue:/.test(e.context))) {
      syntax('function action(page, props, vars, event, resolve, reject) {\n' + entry.code + '\n}', file + ':' + entry.line);
      count++;
    }
  }
  assert.ok(count > 20, 'action extraction must cover the page, not only helpers');
});

test('Agent entry retains release gating, Forms query context and the opt-in fragment', () => {
  const script = blockWith('_c8oProject/mobilePages/Agent.yaml', '/*Begin_c8o_PageInitialization*/');
  const code = script.split('/*Begin_c8o_PageInitialization*/')[1].split('/*End_c8o_PageInitialization*/')[0];
  syntax('function initialize() {' + code + '}', 'Agent initialization');
  const ctx = { URLSearchParams, window: {location: {search: '?embedMode=c8oforms&userId=forms-user&hostOrigin=https%3A%2F%2Fforms.example'}} };
  vm.runInNewContext(ts.transpileModule('this.initialize = function() {' + code + '}', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText, ctx);
  for (const enabled of [true, false]) {
    const calls = [];
    ctx.initialize.call({global: {isAssistantAgentReleaseEnabled:() => enabled}, angularRouter:{navigate:(...args) => calls.push(args)}});
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0][0], enabled ? '/path-to-xfirst' : '/path-to-lightrag');
    assert.equal(calls[0][1].preserveFragment, true);
    if (enabled) {
      assert.equal(calls[0][1].queryParams.userId, 'forms-user');
      assert.equal(calls[0][1].queryParams.embedMode, 'c8oforms');
      assert.equal(calls[0][1].queryParams.agentBridge, '1');
    }
  }
  // Cold opening from the C8Oforms panel: the app onAppInit event defines the switch after this page starts.
  const timers = [];
  ctx.setTimeout = (fn, ms) => timers.push({fn, ms});
  const late = {global: {}, angularRouter: {navigate: (...args) => late.calls.push(args)}, calls: []};
  ctx.initialize.call(late);
  assert.equal(late.calls.length, 0, 'no How-To fallback while the switch is not defined');
  for (let i = 0; i < 3; i++) timers.shift().fn();
  late.global.isAssistantAgentReleaseEnabled = () => true;
  timers.shift().fn();
  assert.equal(late.calls.length, 1);
  assert.equal(late.calls[0][0][0], '/path-to-xfirst');
  assert.equal(late.calls[0][1].queryParams.userId, 'forms-user');
  assert.equal(timers.length, 0);
  const never = {global: {}, angularRouter: {navigate: (...args) => never.calls.push(args)}, calls: []};
  ctx.initialize.call(never);
  let waited = 0;
  while (timers.length) { waited += timers[0].ms; timers.shift().fn(); }
  assert.equal(waited, 5000);
  assert.equal(never.calls.length, 1);
  assert.equal(never.calls[0][0][0], '/path-to-lightrag', 'without the switch the page still ends on How-To');
});

test('host context retains both Studio capabilities and Forms selection, excluding unknown secrets', () => {
  const ast = ts.createSourceFile('page.ts', pageClass(), ts.ScriptTarget.Latest, true);
  const method = ast.statements[0].members.find(m => m.name?.getText(ast) === 'applyAgentHostContext');
  assert.ok(method);
  const ctx = {};
  vm.runInNewContext(ts.transpileModule('class Page {' + method.getText(ast) + '} this.Page = Page;', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText, ctx);
  const p = new ctx.Page();
  Object.assign(p, {normalizeAgentHostContextValue:v=>String(v), ensureC8OformsEmbeddedStyles(){}, applyC8OformsHostLanguage(){}, applyC8OformsHostTheme(){}, scheduleAgentSettingsRefreshAfterHostContext(){}, syncFooterPlaceholder(){}, tick(){}});
  const input = {claudeHomeScope:'conversation', localAssistantVersion:'1.4.15', localMcpVersion:'0.2.7', localAgentBridgeVersion:'0.4.8', localAgentStackUpdateAllowed:false, embedMode:'c8oforms', hostOrigin:'https://forms.example', currentFormName:'Congés', pageName:'Accueil', elementId:'field'};
  p.applyAgentHostContext({...input, rawToken:'secret'});
  assert.deepEqual(JSON.parse(JSON.stringify(p.local.AgentHostContext)), input);
});

test('Forms calls reference renamed libraries while retaining the host message protocol', () => {
  const page = read(pageFile), client = read('js/agent_bridge_client.js');
  assert.doesNotMatch(page, /(?<!lib_)ConvertigoAssistant\.(?:Application|AgentSettings|AgentListConversations|AgentNoCodeContextCatalog)/);
  assert.match(page, /type: "ConvertigoAssistant\.form-updated"/);
  assert.match(client, /callLocalSequence\("lib_ConvertigoMCP", "tools_nocode_baserow_catalog_list"/);
  const sequence = read('_c8oProject/sequences/AgentSendMessage.yaml');
  for (const name of ['claudeHome', 'forceClaudeInstall', 'currentFormId', 'elementId', 'baserowTableId']) assert.match(sequence, new RegExp('↓' + name + ' \\[variables.RequestableVariable-'));
  const catalog = read('_c8oProject/sequences/AgentNoCodeContextCatalog.yaml');
  assert.match(catalog, /^accessibility: Hidden\nauthenticatedContextRequired: true/m);
});

test('Forms styling and Studio inline-error styling remain separate valid stylesheets', () => {
  const sass = require(path.join(root, '_private/ionic/node_modules/sass'));
  const forms = blockWith(pageFile, '/* Scoped to the embedded Forms surface;');
  const studio = blockWith(pageFile, '.agent-operation-error {');
  assert.match(sass.compileString(forms).css, /\.forms-integrated/);
  assert.match(sass.compileString(studio).css, /\.agent-operation-error/);
  assert.doesNotMatch(studio, /\.forms-integrated/);
});
