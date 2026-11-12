'use strict';
// A circuit breaker for commands. An AI that hits an error should find the cause; some keep
// re-running the failing command (or small variations of it) hoping it works. This counts
// failures and says when to stop it:
//   - the same command failed `sameLimit` times, or
//   - `streakLimit` commands in a row failed.
// A success starts the count again, and so does a changed file (the AI may really have fixed something).

const norm = c => String(c || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 300);

function createBreaker({ sameLimit = 3, streakLimit = 4 } = {}) {
  const same = new Map();
  let streak = 0;
  let lastFiles = 0;
  return {
    // Call after every command. Returns null, or { reason: 'same' | 'streak', count } when it should stop.
    record(command, failed, files = 0) {
      if (files !== lastFiles) { lastFiles = files; streak = 0; same.clear(); }
      const key = norm(command);
      if (!failed) { streak = 0; same.delete(key); return null; }
      streak++;
      const n = (same.get(key) || 0) + 1;
      same.set(key, n);
      if (n >= sameLimit) return { reason: 'same', count: n };
      if (streak >= streakLimit) return { reason: 'streak', count: streak };
      return null;
    },
  };
}

const what = trip => trip.reason === 'same' ? `the same command failed ${trip.count} times` : `${trip.count} commands in a row failed`;

// What the person sees when the run is stopped from outside (Claude Code, Codex).
const stopMessage = trip => `Stopped: ${what(trip)} and nothing was fixed in between. The AI was repeating itself instead of finding the cause. Tell it what to try next, or fix the cause yourself.`;

// What an AI that Caret Agent drives itself is told, so it explains instead of retrying.
const lockMessage = trip => `Commands are now locked: ${what(trip)} and nothing was fixed in between. Do not run any more commands. Tell the user in plain words what you tried, what the error says, what you think the cause is, and what they could try.`;

module.exports = { createBreaker, stopMessage, lockMessage };
