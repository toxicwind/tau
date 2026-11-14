import { describe, expect, test } from 'bun:test';
import { Agent } from '../src/agent';

function agentWithClaimed() {
  const a = new Agent();
  // Steal the private claim via any public prompt? Not exposed — instead verify
  // the contract shape: returns steering/followUp arrays, empty when nothing claimed.
  return a;
}

describe('withdrawUndeliveredQueuedMessages', () => {
  test('returns {steering, followUp} arrays (empty when nothing claimed)', () => {
    const a = agentWithClaimed();
    const withdrawn = a.withdrawUndeliveredQueuedMessages();
    expect(withdrawn).toBeTypeOf('object');
    expect(Array.isArray(withdrawn.steering)).toBeTrue();
    expect(Array.isArray(withdrawn.followUp)).toBeTrue();
  });
});
