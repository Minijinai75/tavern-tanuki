import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const connectorSource = readFileSync(
  new URL('../dist/connector.js', import.meta.url),
  'utf8',
);

function createHarness() {
  const listeners = new Map();
  const createdMessages = [];
  let socket;

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      socket = this;
    }

    send(payload) {
      this.sent.push(JSON.parse(payload));
    }

    close() {}
  }

  const context = vm.createContext({
    WebSocket: FakeWebSocket,
    clearTimeout,
    console,
    createChatMessages: async (messages) => createdMessages.push(messages),
    eventOn: (event, listener) => listeners.set(event, listener),
    eventRemoveListener: () => {},
    getChatMessages: () => [],
    getLastMessageId: () => 0,
    setTimeout,
    tavern_events: {
      CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
      GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
      GENERATION_ENDED: 'generation_ended',
      GENERATION_STOPPED: 'generation_stopped',
    },
    toastr: { success: () => {} },
    triggerSlash: async () => '',
    window: { addEventListener: () => {} },
  });

  vm.runInContext(connectorSource, context);
  socket.onopen();

  return { createdMessages, listeners, socket };
}

async function sendCommand(socket, command) {
  await socket.onmessage({ data: JSON.stringify(command) });
  return socket.sent.at(-1);
}

test('play_send creates a visible TavernHelper user message', async () => {
  const { createdMessages, socket } = createHarness();

  const response = await sendCommand(socket, {
    id: 1,
    cmd: 'send',
    args: { text: 'TANUKI_VISIBLE_MARKER', trigger: false },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(createdMessages)), [[{
    role: 'user',
    message: 'TANUKI_VISIBLE_MARKER',
  }]]);
});

test('prompt X-ray captures TavernHelper chat completion payloads', async () => {
  const { listeners, socket } = createHarness();
  listeners.get('chat_completion_prompt_ready')({
    chat: [{ role: 'user', content: 'assembled prompt' }],
    dryRun: false,
  });

  const response = await sendCommand(socket, {
    id: 2,
    cmd: 'prompt',
    args: { mode: 'full' },
  });

  assert.equal(response.ok, true);
  assert.equal(response.data.message_count, 1);
  assert.equal(response.data.messages[0].content, 'assembled prompt');
});
