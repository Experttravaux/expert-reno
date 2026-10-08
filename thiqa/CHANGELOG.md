# Changelog

## [0.1.0] — 2026-10-08 — Phase 0 : fondations

### Ajouté

- Monorepo pnpm + Turborepo (`apps/web`, `apps/tech`, `packages/{core,db,ai,ui}`, `supabase/`), TypeScript strict, ESLint, Prettier.
- `@thiqa/core` :
  - machine à états des commandes (18 statuts, 65 transitions, gardes, effets déclarés) ;
  - schéma Zod des trames de visite + trame **v1 : 163 points sur 9 blocs** (dont 12 répétés par pièce) ;
  - évaluation de sévérité (règles template, mesures, arbitrage technicien / IA / relecteur), contrôle « prêt à soumettre » ;
  - scores technique, habitabilité, rentabilité locative, chiffrage travaux, recommandation de base (`SCORING_VERSION = 1.0.0`) ;
  - calcul de prix (règles empilables, options, acompte 50 %) ;
  - catalogue de prix travaux (54 postes, base Marrakech).
- Base Supabase : 6 migrations — 38 tables, RLS sur toutes, privilèges par colonne, garde de transition des commandes en base, journal d'événements append-only, horloges SLA + `app.sla_tick()` planifié par pg_cron (relances, expiration des offres, escalades, annulation auto), buckets Storage privés, hook JWT `user_role`, 2FA obligatoire pour le staff.
- Seed généré depuis `@thiqa/core` (Marrakech + 3 secteurs, 2 produits actifs + VEFA inactif, tarifs, catalogue travaux, barème de paie, 74 modèles de notification FR — 37 clés × email + WhatsApp) + comptes de démo locaux.
- Tests : 116 tests unitaires (100 % de couverture sur machine à états, scoring et sévérité), 19 tests de synchronisation SQL ↔ core, 4 suites SQL (machine à états, RLS, SLA, géographie).
- CI GitHub Actions : format, lint, typecheck, tests, Supabase local + tests SQL + `db lint`, génération des types, `db push` sur `main`.
