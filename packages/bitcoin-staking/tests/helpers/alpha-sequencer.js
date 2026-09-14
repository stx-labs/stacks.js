// Lexicographical (code-point) run order. Order-sensitive suites opt in with a
// numeric filename prefix (`01-`, …); digits sort ahead of the rest.
const Sequencer = require('@jest/test-sequencer').default;

class AlphaSequencer extends Sequencer {
  sort(tests) {
    return [...tests].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
}

module.exports = AlphaSequencer;
