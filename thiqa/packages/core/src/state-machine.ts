// Order lifecycle state machine (§6). Pure: callers persist the result.
// The DB enforces the same (from, to) pairs through `order_transitions`
// (see supabase/migrations), kept in sync by a test in packages/db.

import type { OrderStatus } from './domain';

export const MAX_DISPATCH_ATTEMPTS = 3;
export const MAX_AI_ATTEMPTS = 3;

export type Actor =
  'client' | 'technician' | 'reviewer' | 'dispatcher' | 'admin' | 'partner' | 'system';

export type OrderEvent =
  | 'checkout'
  | 'deposit_paid'
  | 'payment_timeout'
  | 'start_dispatch'
  | 'technician_assigned'
  | 'dispatch_exhausted'
  | 'technician_accepted'
  | 'offer_declined'
  | 'offer_expired'
  | 'unassign'
  | 'visit_scheduled'
  | 'visit_rescheduled'
  | 'visit_started'
  | 'inspection_submitted'
  | 'returned_to_technician'
  | 'ai_started'
  | 'ai_completed'
  | 'ai_failed'
  | 'report_regenerate'
  | 'report_validated'
  | 'report_delivered'
  | 'balance_paid'
  | 'close'
  | 'cancel'
  | 'refund_completed'
  | 'hold'
  | 'resume';

export type Audience = 'client' | 'technician' | 'dispatcher' | 'reviewer' | 'admin' | 'partner';

export type SideEffect =
  | { kind: 'notify'; template: string; audience: readonly Audience[] }
  | { kind: 'job'; job: 'dispatch' | 'generate_report' | 'render_pdf' }
  | { kind: 'payment'; action: 'request_balance' | 'refund_deposit' }
  | { kind: 'webhook'; event: 'order.status_changed' | 'report.delivered' };

/** Facts the guards need. Callers only provide what is relevant. */
export interface TransitionContext {
  now?: Date;
  hasProduct?: boolean;
  hasProperty?: boolean;
  priceMad?: number | null;
  requestedSlots?: number;
  depositPaidAt?: Date | null;
  balancePaidAt?: Date | null;
  technicianId?: string | null;
  /** Attempt number of the mission that was just declined/expired (1-based). */
  missionAttempt?: number;
  scheduledAt?: Date | null;
  checkedIn?: boolean;
  inspectionComplete?: boolean;
  /** Number of AI generation attempts already made, including the failed one. */
  aiAttempts?: number;
  reportValidated?: boolean;
  /** Status to go back to when leaving `on_hold`. */
  resumeTo?: OrderStatus | null;
}

/** Returns null when the guard passes, otherwise a machine-readable reason. */
type Guard = (ctx: TransitionContext) => string | null;

export interface Transition {
  from: OrderStatus;
  event: OrderEvent;
  to: OrderStatus;
  actors: readonly Actor[];
  guard?: Guard;
  effects: readonly SideEffect[];
}

export const TERMINAL_STATUSES: readonly OrderStatus[] = ['closed', 'refunded'];

/** Statuses from which an order can be put on hold and resumed to. */
export const HOLDABLE_STATUSES: readonly OrderStatus[] = [
  'awaiting_payment',
  'paid',
  'dispatching',
  'assigned',
  'accepted',
  'scheduled',
  'in_progress',
  'submitted',
  'ai_processing',
  'in_review',
  'validated',
  'delivered',
  'reassigning',
];

/** Paid statuses where cancelling triggers a deposit refund. */
const CANCELLABLE_AFTER_PAYMENT: readonly OrderStatus[] = [
  'paid',
  'dispatching',
  'reassigning',
  'assigned',
  'accepted',
  'scheduled',
];

const STAFF: readonly Actor[] = ['dispatcher', 'admin'];
const SYSTEM_OR_STAFF: readonly Actor[] = ['system', 'dispatcher', 'admin'];

// --- guards -----------------------------------------------------------------

const checkoutReady: Guard = (c) => {
  if (!c.hasProduct) return 'missing_product';
  if (!c.hasProperty) return 'missing_property';
  if (c.priceMad == null || c.priceMad <= 0) return 'missing_price';
  if ((c.requestedSlots ?? 0) < 1) return 'missing_slots';
  return null;
};
const depositPaid: Guard = (c) => (c.depositPaidAt ? null : 'deposit_not_paid');
const balancePaid: Guard = (c) => (c.balancePaidAt ? null : 'balance_not_paid');
const hasTechnician: Guard = (c) => (c.technicianId ? null : 'missing_technician');
const missionAttempt = (c: TransitionContext) => c.missionAttempt ?? 1;
const attemptsLeft: Guard = (c) =>
  missionAttempt(c) < MAX_DISPATCH_ATTEMPTS ? null : 'dispatch_attempts_exhausted';
const attemptsExhausted: Guard = (c) =>
  missionAttempt(c) >= MAX_DISPATCH_ATTEMPTS ? null : 'dispatch_attempts_left';
const scheduledInFuture: Guard = (c) => {
  if (!c.scheduledAt) return 'missing_schedule';
  const now = c.now ?? new Date();
  return c.scheduledAt.getTime() > now.getTime() ? null : 'schedule_in_past';
};
const checkedIn: Guard = (c) => (c.checkedIn ? null : 'not_checked_in');
const inspectionComplete: Guard = (c) => (c.inspectionComplete ? null : 'inspection_incomplete');
const aiAttempts = (c: TransitionContext) => c.aiAttempts ?? 1;
const aiRetriesLeft: Guard = (c) =>
  aiAttempts(c) < MAX_AI_ATTEMPTS ? null : 'ai_attempts_exhausted';
const aiRetriesExhausted: Guard = (c) =>
  aiAttempts(c) >= MAX_AI_ATTEMPTS ? null : 'ai_attempts_left';
const reportValidated: Guard = (c) => (c.reportValidated ? null : 'report_not_validated');
const resumeTo =
  (status: OrderStatus): Guard =>
  (c) =>
    c.resumeTo === status ? null : 'resume_target_mismatch';

// --- transitions --------------------------------------------------------------

const notify = (template: string, ...audience: Audience[]): SideEffect => ({
  kind: 'notify',
  template,
  audience,
});

function t(
  from: OrderStatus,
  event: OrderEvent,
  to: OrderStatus,
  actors: readonly Actor[],
  effects: readonly SideEffect[] = [],
  guard?: Guard,
): Transition {
  return guard ? { from, event, to, actors, effects, guard } : { from, event, to, actors, effects };
}

const declineOrExpire = (event: 'offer_declined' | 'offer_expired'): Transition[] => [
  t(
    'assigned',
    event,
    'dispatching',
    ['technician', 'system'],
    [{ kind: 'job', job: 'dispatch' }],
    attemptsLeft,
  ),
  t(
    'assigned',
    event,
    'reassigning',
    ['technician', 'system'],
    [notify('dispatch_exhausted', 'dispatcher')],
    attemptsExhausted,
  ),
];

export const TRANSITIONS: readonly Transition[] = [
  // Ordering & payment
  t(
    'draft',
    'checkout',
    'awaiting_payment',
    ['client', 'partner', 'admin', 'system'],
    [notify('order_created', 'client')],
    checkoutReady,
  ),
  t('draft', 'cancel', 'cancelled', ['client', 'partner', 'admin']),
  t(
    'awaiting_payment',
    'deposit_paid',
    'paid',
    ['system'],
    [notify('deposit_received', 'client'), { kind: 'job', job: 'dispatch' }],
    depositPaid,
  ),
  t(
    'awaiting_payment',
    'payment_timeout',
    'cancelled',
    ['system'],
    [notify('order_cancelled_unpaid', 'client')],
  ),
  t(
    'awaiting_payment',
    'cancel',
    'cancelled',
    ['client', 'partner', 'admin'],
    [notify('order_cancelled', 'client')],
  ),

  // Dispatch
  t('paid', 'start_dispatch', 'dispatching', SYSTEM_OR_STAFF),
  t(
    'dispatching',
    'technician_assigned',
    'assigned',
    SYSTEM_OR_STAFF,
    [notify('mission_offer', 'technician')],
    hasTechnician,
  ),
  t(
    'reassigning',
    'technician_assigned',
    'assigned',
    SYSTEM_OR_STAFF,
    [notify('mission_offer', 'technician')],
    hasTechnician,
  ),
  t('reassigning', 'start_dispatch', 'dispatching', STAFF),
  t(
    'dispatching',
    'dispatch_exhausted',
    'reassigning',
    ['system'],
    [notify('dispatch_exhausted', 'dispatcher')],
  ),
  t(
    'assigned',
    'technician_accepted',
    'accepted',
    ['technician'],
    [notify('technician_assigned', 'client')],
  ),
  ...declineOrExpire('offer_declined'),
  ...declineOrExpire('offer_expired'),
  t(
    'accepted',
    'unassign',
    'reassigning',
    ['technician', 'dispatcher', 'admin'],
    [notify('mission_unassigned', 'dispatcher')],
  ),
  t(
    'scheduled',
    'unassign',
    'reassigning',
    ['technician', 'dispatcher', 'admin'],
    [notify('mission_unassigned', 'dispatcher', 'client')],
  ),

  // Visit
  t(
    'accepted',
    'visit_scheduled',
    'scheduled',
    ['technician', 'client', 'dispatcher', 'admin'],
    [notify('visit_scheduled', 'client', 'technician')],
    scheduledInFuture,
  ),
  t(
    'scheduled',
    'visit_rescheduled',
    'scheduled',
    ['technician', 'client', 'dispatcher', 'admin'],
    [notify('visit_rescheduled', 'client', 'technician')],
    scheduledInFuture,
  ),
  t(
    'scheduled',
    'visit_started',
    'in_progress',
    ['technician'],
    [notify('visit_started', 'client')],
    checkedIn,
  ),
  t(
    'in_progress',
    'inspection_submitted',
    'submitted',
    ['technician'],
    [{ kind: 'job', job: 'generate_report' }],
    inspectionComplete,
  ),

  // AI & review
  t('submitted', 'ai_started', 'ai_processing', ['system']),
  t(
    'ai_processing',
    'ai_completed',
    'in_review',
    ['system'],
    [notify('report_to_review', 'reviewer')],
  ),
  t(
    'ai_processing',
    'ai_failed',
    'submitted',
    ['system'],
    [{ kind: 'job', job: 'generate_report' }],
    aiRetriesLeft,
  ),
  t(
    'ai_processing',
    'ai_failed',
    'on_hold',
    ['system'],
    [notify('ai_failed', 'admin')],
    aiRetriesExhausted,
  ),
  t(
    'in_review',
    'report_regenerate',
    'ai_processing',
    ['reviewer', 'admin'],
    [{ kind: 'job', job: 'generate_report' }],
  ),
  t(
    'in_review',
    'returned_to_technician',
    'in_progress',
    ['reviewer', 'admin'],
    [notify('inspection_returned', 'technician')],
  ),
  t(
    'in_review',
    'report_validated',
    'validated',
    ['reviewer', 'admin'],
    [{ kind: 'job', job: 'render_pdf' }],
    reportValidated,
  ),

  // Delivery & closing
  t(
    'validated',
    'report_delivered',
    'delivered',
    ['system', 'reviewer', 'admin'],
    [
      notify('report_delivered', 'client', 'partner'),
      { kind: 'webhook', event: 'report.delivered' },
      { kind: 'payment', action: 'request_balance' },
    ],
  ),
  t(
    'delivered',
    'balance_paid',
    'closed',
    ['system'],
    [notify('rating_request', 'client')],
    balancePaid,
  ),
  t('delivered', 'close', 'closed', ['admin']),

  // Cancellation & refunds
  ...CANCELLABLE_AFTER_PAYMENT.map((from) =>
    t(
      from,
      'cancel',
      'cancelled',
      ['client', 'partner', 'dispatcher', 'admin'],
      [
        notify('order_cancelled', 'client', 'technician'),
        { kind: 'payment', action: 'refund_deposit' },
      ],
    ),
  ),
  t(
    'on_hold',
    'cancel',
    'cancelled',
    ['admin'],
    [notify('order_cancelled', 'client'), { kind: 'payment', action: 'refund_deposit' }],
  ),
  t(
    'cancelled',
    'refund_completed',
    'refunded',
    ['system'],
    [notify('refund_completed', 'client')],
  ),

  // Hold / resume
  ...HOLDABLE_STATUSES.map((from) => t(from, 'hold', 'on_hold', STAFF)),
  ...HOLDABLE_STATUSES.map((to) => t('on_hold', 'resume', to, STAFF, [], resumeTo(to))),
];

// --- API ------------------------------------------------------------------------

export type TransitionResult =
  | {
      ok: true;
      from: OrderStatus;
      to: OrderStatus;
      event: OrderEvent;
      actor: Actor;
      effects: readonly SideEffect[];
    }
  | {
      ok: false;
      error: 'unknown_transition' | 'forbidden_actor' | 'guard_failed';
      reason: string;
    };

const STATUS_CHANGED: SideEffect = { kind: 'webhook', event: 'order.status_changed' };

export function transition(
  from: OrderStatus,
  event: OrderEvent,
  actor: Actor,
  ctx: TransitionContext = {},
): TransitionResult {
  const candidates = TRANSITIONS.filter((tr) => tr.from === from && tr.event === event);
  if (candidates.length === 0) {
    return { ok: false, error: 'unknown_transition', reason: `${from} --${event}--> ?` };
  }
  const allowed = candidates.filter((tr) => tr.actors.includes(actor));
  if (allowed.length === 0) {
    return { ok: false, error: 'forbidden_actor', reason: `${actor} cannot ${event} from ${from}` };
  }
  let firstReason = '';
  for (const tr of allowed) {
    const reason = tr.guard ? tr.guard(ctx) : null;
    if (reason === null) {
      return { ok: true, from, to: tr.to, event, actor, effects: [...tr.effects, STATUS_CHANGED] };
    }
    firstReason ||= reason;
  }
  return { ok: false, error: 'guard_failed', reason: firstReason };
}

export function availableEvents(from: OrderStatus, actor: Actor): OrderEvent[] {
  const events = TRANSITIONS.filter((tr) => tr.from === from && tr.actors.includes(actor)).map(
    (tr) => tr.event,
  );
  return [...new Set(events)];
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** (from, to, event) triples — the shape stored in the `order_transitions` table. */
export function transitionPairs(): Array<{
  from: OrderStatus;
  to: OrderStatus;
  event: OrderEvent;
}> {
  return TRANSITIONS.map(({ from, to, event }) => ({ from, to, event }));
}
