// The home button lists the conversations again: a list that fails or never answers must not leave the start screen
// on "Loading previous conversations" (17/11: the panel stayed there until the Studio restarted).
const test = require('node:test');
const assert = require('node:assert/strict');
const { formattedBlocks } = require('./helpers/assistant-source.cjs');

const blocks = formattedBlocks('_c8oProject/mobilePages/Page.yaml');
const homeBlock = blocks.filter((code) => code.includes('page.local.AgentHomeListToken = homeLoad'));
const failureBlock = blocks.filter((code) => code.includes('Unable to list the conversations from the home button'));

function run(code, page, timers) {
  const action = new Function('page', 'props', 'vars', 'event', 'resolve', 'reject', 'setTimeout', code);
  action(page, { stack: { root: { out: { error: 'refused' } } } }, {}, null, () => {}, (e) => { throw e; }, (fn, ms) => timers.push({ fn, ms }));
}

function homePage() {
  return {
    local: { AgentConversationsLoading: false },
    global: {},
    c8o: { log: { warn() {} } },
    tick() {},
    setEnableChat() {},
    focusQuestionInput() {},
    getEffectiveProjectName: () => '',
    isEmbeddedInC8Oforms: () => false
  };
}

test('the home button arms a 15 s end of the loading state, ignored once the list answered or a newer click took over', () => {
  assert.equal(homeBlock.length, 1);
  const page = homePage(), timers = [];
  run(homeBlock[0], page, timers);
  assert.equal(page.local.AgentConversationsLoading, true);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 15000);
  timers[0].fn();
  assert.equal(page.local.AgentConversationsLoading, false, 'a list that never answers ends the loading state');

  const answered = homePage(), timers2 = [];
  run(homeBlock[0], answered, timers2);
  answered.local.AgentConversationsLoading = false;
  answered.local.AgentConversations = [{ id: 'a' }];
  timers2[0].fn();
  assert.equal(answered.local.AgentConversationsLoading, false);

  const twice = homePage(), timers3 = [];
  run(homeBlock[0], twice, timers3);
  run(homeBlock[0], twice, timers3);
  timers3[0].fn();
  assert.equal(twice.local.AgentConversationsLoading, true, 'the first click\'s timer leaves the second click\'s list alone');
  timers3[1].fn();
  assert.equal(twice.local.AgentConversationsLoading, false);
});

test('a failed list from the home button ends the loading state at once', () => {
  assert.equal(failureBlock.length, 1);
  const page = homePage(), timers = [];
  page.local.AgentConversationsLoading = true;
  page.local.AgentHomeListToken = 'pending';
  run(failureBlock[0], page, timers);
  assert.equal(page.local.AgentConversationsLoading, false);
  assert.equal(page.local.AgentHomeListToken, '');
});
