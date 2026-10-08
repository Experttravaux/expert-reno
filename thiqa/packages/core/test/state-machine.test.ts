import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, type OrderStatus } from '../src/domain';
import {
  HOLDABLE_STATUSES,
  MAX_AI_ATTEMPTS,
  MAX_DISPATCH_ATTEMPTS,
  TRANSITIONS,
  availableEvents,
  isTerminal,
  transition,
  transitionPairs,
  type Actor,
  type OrderEvent,
  type TransitionContext,
} from '../src/state-machine';

const NOW = new Date('2026-10-08T10:00:00Z');
const TOMORROW = new Date('2026-10-09T10:00:00Z');

function step(from: OrderStatus, event: OrderEvent, actor: Actor, ctx: TransitionContext = {}) {
  const r = transition(from, event, actor, { now: NOW, ...ctx });
  if (!r.ok) throw new Error(`${from} --${event}/${actor}--> failed: ${r.error} ${r.reason}`);
  return r;
}

describe('order state machine — happy path', () => {
  it('goes from draft to closed', () => {
    const path: Array<[OrderStatus, OrderEvent, Actor, TransitionContext, OrderStatus]> = [
      [
        'draft',
        'checkout',
        'client',
        { hasProduct: true, hasProperty: true, priceMad: 1500, requestedSlots: 3 },
        'awaiting_payment',
      ],
      ['awaiting_payment', 'deposit_paid', 'system', { depositPaidAt: NOW }, 'paid'],
      ['paid', 'start_dispatch', 'system', {}, 'dispatching'],
      ['dispatching', 'technician_assigned', 'system', { technicianId: 't1' }, 'assigned'],
      ['assigned', 'technician_accepted', 'technician', {}, 'accepted'],
      ['accepted', 'visit_scheduled', 'technician', { scheduledAt: TOMORROW }, 'scheduled'],
      ['scheduled', 'visit_rescheduled', 'client', { scheduledAt: TOMORROW }, 'scheduled'],
      ['scheduled', 'visit_started', 'technician', { checkedIn: true }, 'in_progress'],
      [
        'in_progress',
        'inspection_submitted',
        'technician',
        { inspectionComplete: true },
        'submitted',
      ],
      ['submitted', 'ai_started', 'system', {}, 'ai_processing'],
      ['ai_processing', 'ai_completed', 'system', {}, 'in_review'],
      ['in_review', 'report_validated', 'reviewer', { reportValidated: true }, 'validated'],
      ['validated', 'report_delivered', 'system', {}, 'delivered'],
      ['delivered', 'balance_paid', 'system', { balancePaidAt: NOW }, 'closed'],
    ];
    for (const [from, event, actor, ctx, to] of path) {
      expect(step(from, event, actor, ctx).to).toBe(to);
    }
  });

  it('always appends the status_changed webhook and declares side effects', () => {
    const r = step('validated', 'report_delivered', 'system');
    expect(r.effects).toContainEqual({ kind: 'webhook', event: 'order.status_changed' });
    expect(r.effects).toContainEqual({ kind: 'webhook', event: 'report.delivered' });
    expect(r.effects).toContainEqual({ kind: 'payment', action: 'request_balance' });
    expect(step('paid', 'start_dispatch', 'system').effects).toEqual([
      { kind: 'webhook', event: 'order.status_changed' },
    ]);
  });

  it('works without an explicit context', () => {
    expect(transition('paid', 'start_dispatch', 'system')).toMatchObject({
      ok: true,
      to: 'dispatching',
    });
  });
});

describe('guards', () => {
  const ready = { hasProduct: true, hasProperty: true, priceMad: 1500, requestedSlots: 1 };
  it.each([
    [{ ...ready, hasProduct: false }, 'missing_product'],
    [{ ...ready, hasProperty: false }, 'missing_property'],
    [{ ...ready, priceMad: null }, 'missing_price'],
    [{ ...ready, priceMad: 0 }, 'missing_price'],
    [{ ...ready, requestedSlots: 0 }, 'missing_slots'],
    [{ hasProduct: true, hasProperty: true, priceMad: 10 }, 'missing_slots'],
  ])('checkout refuses %o', (ctx, reason) => {
    expect(transition('draft', 'checkout', 'client', ctx)).toEqual({
      ok: false,
      error: 'guard_failed',
      reason,
    });
  });

  it.each<[OrderStatus, OrderEvent, Actor, TransitionContext, string]>([
    ['awaiting_payment', 'deposit_paid', 'system', { depositPaidAt: null }, 'deposit_not_paid'],
    ['delivered', 'balance_paid', 'system', {}, 'balance_not_paid'],
    ['dispatching', 'technician_assigned', 'dispatcher', {}, 'missing_technician'],
    ['accepted', 'visit_scheduled', 'technician', {}, 'missing_schedule'],
    [
      'accepted',
      'visit_scheduled',
      'technician',
      { scheduledAt: new Date('2020-01-01') },
      'schedule_in_past',
    ],
    ['scheduled', 'visit_started', 'technician', {}, 'not_checked_in'],
    ['in_progress', 'inspection_submitted', 'technician', {}, 'inspection_incomplete'],
    ['in_review', 'report_validated', 'reviewer', {}, 'report_not_validated'],
  ])('%s --%s--> refused (%s)', (from, event, actor, ctx, reason) => {
    expect(transition(from, event, actor, ctx)).toEqual({
      ok: false,
      error: 'guard_failed',
      reason,
    });
  });

  it('uses the real clock when no `now` is given', () => {
    const future = new Date(Date.now() + 3_600_000);
    expect(
      transition('accepted', 'visit_scheduled', 'technician', { scheduledAt: future }).ok,
    ).toBe(true);
  });
});

describe('dispatch retries', () => {
  it.each(['offer_declined', 'offer_expired'] as const)(
    '%s re-dispatches until max attempts',
    (event) => {
      expect(step('assigned', event, 'system', { missionAttempt: 1 }).to).toBe('dispatching');
      expect(step('assigned', event, 'system').to).toBe('dispatching');
      const last = step('assigned', event, 'technician', { missionAttempt: MAX_DISPATCH_ATTEMPTS });
      expect(last.to).toBe('reassigning');
      expect(last.effects[0]).toEqual({
        kind: 'notify',
        template: 'dispatch_exhausted',
        audience: ['dispatcher'],
      });
    },
  );

  it('complementary guards report why they do not apply', () => {
    const guardOf = (event: OrderEvent, to: OrderStatus) =>
      TRANSITIONS.find((t) => t.event === event && t.to === to)?.guard;
    expect(guardOf('offer_declined', 'reassigning')?.({ missionAttempt: 1 })).toBe(
      'dispatch_attempts_left',
    );
    expect(guardOf('offer_declined', 'dispatching')?.({ missionAttempt: 3 })).toBe(
      'dispatch_attempts_exhausted',
    );
    expect(guardOf('ai_failed', 'on_hold')?.({ aiAttempts: 1 })).toBe('ai_attempts_left');
    expect(guardOf('ai_failed', 'submitted')?.({ aiAttempts: 3 })).toBe('ai_attempts_exhausted');
  });

  it('dispatcher can reassign or restart dispatch', () => {
    expect(
      step('reassigning', 'technician_assigned', 'dispatcher', { technicianId: 't2' }).to,
    ).toBe('assigned');
    expect(step('reassigning', 'start_dispatch', 'dispatcher').to).toBe('dispatching');
    expect(step('dispatching', 'dispatch_exhausted', 'system').to).toBe('reassigning');
    expect(step('accepted', 'unassign', 'technician').to).toBe('reassigning');
    expect(step('scheduled', 'unassign', 'dispatcher').to).toBe('reassigning');
  });
});

describe('AI processing', () => {
  it('retries then puts the order on hold', () => {
    expect(step('ai_processing', 'ai_failed', 'system').to).toBe('submitted');
    expect(
      step('ai_processing', 'ai_failed', 'system', { aiAttempts: MAX_AI_ATTEMPTS - 1 }).to,
    ).toBe('submitted');
    expect(step('ai_processing', 'ai_failed', 'system', { aiAttempts: MAX_AI_ATTEMPTS }).to).toBe(
      'on_hold',
    );
  });

  it('reviewer can regenerate or send back to the technician', () => {
    expect(step('in_review', 'report_regenerate', 'reviewer').to).toBe('ai_processing');
    expect(step('in_review', 'returned_to_technician', 'reviewer').to).toBe('in_progress');
  });
});

describe('cancellation, refunds, hold', () => {
  it('cancels before payment without refund', () => {
    expect(step('draft', 'cancel', 'client').to).toBe('cancelled');
    const r = step('awaiting_payment', 'payment_timeout', 'system');
    expect(r.to).toBe('cancelled');
    expect(r.effects.some((e) => e.kind === 'payment')).toBe(false);
  });

  it.each(['paid', 'dispatching', 'reassigning', 'assigned', 'accepted', 'scheduled'] as const)(
    'cancelling from %s refunds the deposit',
    (from) => {
      const r = step(from, 'cancel', 'client');
      expect(r.to).toBe('cancelled');
      expect(r.effects).toContainEqual({ kind: 'payment', action: 'refund_deposit' });
    },
  );

  it('cannot cancel once the visit started', () => {
    expect(transition('in_progress', 'cancel', 'client').ok).toBe(false);
  });

  it('refund completes, admin can close without balance', () => {
    expect(step('cancelled', 'refund_completed', 'system').to).toBe('refunded');
    expect(step('delivered', 'close', 'admin').to).toBe('closed');
    expect(step('on_hold', 'cancel', 'admin').to).toBe('cancelled');
  });

  it.each(HOLDABLE_STATUSES)('holds and resumes %s', (status) => {
    expect(step(status, 'hold', 'dispatcher').to).toBe('on_hold');
    expect(step('on_hold', 'resume', 'admin', { resumeTo: status }).to).toBe(status);
  });

  it('refuses to resume to an invalid target', () => {
    expect(transition('on_hold', 'resume', 'admin', { resumeTo: 'closed' })).toEqual({
      ok: false,
      error: 'guard_failed',
      reason: 'resume_target_mismatch',
    });
  });
});

describe('errors and helpers', () => {
  it('rejects unknown transitions', () => {
    expect(transition('closed', 'cancel', 'admin')).toMatchObject({
      ok: false,
      error: 'unknown_transition',
    });
  });

  it('rejects forbidden actors', () => {
    expect(
      transition('awaiting_payment', 'deposit_paid', 'client', { depositPaidAt: NOW }),
    ).toMatchObject({
      ok: false,
      error: 'forbidden_actor',
    });
    expect(transition('in_review', 'report_validated', 'technician')).toMatchObject({
      error: 'forbidden_actor',
    });
  });

  it('lists available events per actor without duplicates', () => {
    expect(availableEvents('assigned', 'technician').sort()).toEqual([
      'offer_declined',
      'offer_expired',
      'technician_accepted',
    ]);
    expect(availableEvents('on_hold', 'admin')).toEqual(['cancel', 'resume']);
    expect(availableEvents('closed', 'admin')).toEqual([]);
  });

  it('flags terminal statuses', () => {
    expect(isTerminal('closed')).toBe(true);
    expect(isTerminal('refunded')).toBe(true);
    expect(isTerminal('cancelled')).toBe(false);
  });

  it('declares each (from, to, event) triple once', () => {
    const keys = transitionPairs().map((p) => `${p.from}|${p.to}|${p.event}`);
    expect(new Set(keys).size).toBe(TRANSITIONS.length);
  });

  it('every non-terminal status can be left, every status is reachable', () => {
    for (const s of ORDER_STATUSES) {
      if (!isTerminal(s))
        expect(
          TRANSITIONS.some((t) => t.from === s),
          `leave ${s}`,
        ).toBe(true);
      if (s !== 'draft')
        expect(
          TRANSITIONS.some((t) => t.to === s),
          `reach ${s}`,
        ).toBe(true);
    }
  });
});
