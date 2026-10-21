// One tab at a time in this browser. Tabs talk over a BroadcastChannel:
// a newly opened tab announces itself ('hello'); open tabs hand it their
// session ('session') and step aside, so the newest tab takes over without
// signing in again. Signing out in one tab signs out all of them.
const CHANNEL = 'fa-management-tabs';
const tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;

const listeners = new Set();
if (channel) {
  channel.onmessage = (e) => {
    const msg = e.data || {};
    if (msg.from === tabId) return;
    listeners.forEach((fn) => fn(msg));
  };
}

export function post(type, data = {}) {
  if (channel) channel.postMessage({ ...data, type, from: tabId });
}

export function onMessage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Announces this tab; resolves with a session handed over by another open
// tab ({ token, user }) or null when none answers in time
export function announce(wait = 350) {
  if (!channel) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const stop = onMessage((msg) => {
      if (msg.type === 'session' && msg.to === tabId && !done) {
        done = true;
        stop();
        resolve(msg.token ? { token: msg.token, user: msg.user } : null);
      }
    });
    post('hello');
    setTimeout(() => { if (!done) { done = true; stop(); resolve(null); } }, wait);
  });
}

export const thisTab = tabId;
