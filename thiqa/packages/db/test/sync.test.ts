// Keeps SQL artefacts in sync with @thiqa/core (the source of truth).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as core from '@thiqa/core';
import { SEED_PATH, buildSeed } from '../scripts/gen-seed';
import { NOTIFICATION_TEMPLATES, templatesUsedByStateMachine } from '../scripts/seed-data';

const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));
const allSql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(MIGRATIONS + f, 'utf8'))
  .join('\n');

function sqlEnum(name: string): string[] {
  const m = allSql.match(new RegExp(`create type public\\.${name} as enum \\(([^;]*?)\\);`, 's'));
  if (!m?.[1]) throw new Error(`enum ${name} not found`);
  return [...m[1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1] as string);
}

describe('SQL enums mirror @thiqa/core', () => {
  it.each([
    ['app_role', core.APP_ROLES],
    ['severity', core.SEVERITIES],
    ['property_type', core.PROPERTY_TYPES],
    ['order_purpose', core.PURPOSES],
    ['order_status', core.ORDER_STATUSES],
    ['order_source', core.ORDER_SOURCES],
    ['mission_status', core.MISSION_STATUSES],
    ['technician_status', core.TECHNICIAN_STATUSES],
    ['report_status', core.REPORT_STATUSES],
    ['media_kind', core.MEDIA_KINDS],
    ['payment_provider', core.PAYMENT_PROVIDERS],
    ['payment_kind', core.PAYMENT_KINDS],
    ['payment_status', core.PAYMENT_STATUSES],
    ['notification_channel', core.NOTIFICATION_CHANNELS],
    ['notification_status', core.NOTIFICATION_STATUSES],
    ['lang', core.LANGS],
  ] as const)('%s', (name, values) => {
    expect(sqlEnum(name)).toEqual([...values]);
  });
});

describe('order_transitions mirror the state machine', () => {
  it('declares exactly the core transitions', () => {
    // If this fails after changing TRANSITIONS: add a NEW migration updating
    // public.order_transitions and update the expected rows below accordingly.
    const block =
      allSql.match(/-- BEGIN GENERATED TRANSITIONS([\s\S]*?)-- END GENERATED TRANSITIONS/)?.[1] ??
      '';
    const sqlRows = [...block.matchAll(/\('([a-z_]+)', '([a-z_]+)', '([a-z_]+)'\)/g)].map(
      (m) => `${m[1]}|${m[2]}|${m[3]}`,
    );
    const coreRows = core.transitionPairs().map((p) => `${p.from}|${p.to}|${p.event}`);
    expect([...sqlRows].sort()).toEqual([...coreRows].sort());
  });
});

describe('seed', () => {
  it('supabase/seed.sql is up to date (run `pnpm db:seed:gen`)', () => {
    expect(readFileSync(SEED_PATH, 'utf8')).toBe(buildSeed());
  });

  it('has an email and a WhatsApp template for every state machine notification', () => {
    for (const key of templatesUsedByStateMachine()) {
      for (const channel of ['email', 'whatsapp']) {
        expect(
          NOTIFICATION_TEMPLATES.some((t) => t.key === key && t.channel === channel),
          `${key}/${channel}`,
        ).toBe(true);
      }
    }
  });
});
