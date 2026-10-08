# Thiqa (ثقة) — contrôle technique immobilier à la demande

Commande en ligne → technicien assigné automatiquement → visite guidée sur mobile → pré-rapport IA →
validation par l'expert → rapport PDF avec scores, code couleur et chiffrage des travaux.

**État : Phase 0 (fondations) livrée** — voir [CHANGELOG](./CHANGELOG.md). Aucune interface n'est codée avant validation.

## Architecture (choix clés)

- **Le domaine est du code pur** (`@thiqa/core`) : machine à états, scoring, trame, tarifs. Il est testé à 100 % et ne dépend ni de Next.js ni de Supabase, pour être réutilisé à l'identique dans le front, les Edge Functions et Smart BNB.
- **La base se défend seule** : RLS sur toutes les tables, privilèges par colonne, et un trigger qui refuse toute transition de commande non déclarée dans `order_transitions` (copie de la machine à états, vérifiée par test). Les traitements serveur passent par `service_role`.
- **Tout changement d'état est un événement** (`events`, append-only) et chaque étape a une horloge SLA (`order_sla_clocks`) : `app.sla_tick()` tourne toutes les 5 min (pg_cron) pour les relances, expirations d'offres, escalades et annulations.

Écart assumé par rapport au brief : les migrations sont dans `supabase/migrations` (emplacement imposé par la CLI Supabase) ; `packages/db` contient le générateur de seed, les tests de synchronisation et les types générés.

```
thiqa/
  apps/web/            # Phase 1 — site public, espace client, back-office
  apps/tech/           # Phase 2 — PWA technicien
  packages/core/       # domaine : state-machine, checklist (trame v1), scoring, pricing
  packages/db/         # seed généré, tests SQL ↔ core, scripts, types générés
  packages/ai/         # Phase 3 — prompts versionnés, pipeline rapport
  packages/ui/         # Phase 1 — composants shadcn/ui partagés
  supabase/
    migrations/        # 6 migrations : schéma, triggers, SLA, RLS, storage
    seed.sql           # GÉNÉRÉ (pnpm db:seed:gen) — données de référence idempotentes
    seed.dev.sql       # comptes de démo, local uniquement
    tests/             # tests SQL (machine à états, RLS, SLA, géographie)
    functions/         # Edge Functions (Phases 1–4)
```

## Lancer en local

Prérequis : Node 22, pnpm 10, Docker (pour Supabase local).

```bash
cd thiqa
pnpm install
pnpm test                 # tests unitaires + synchronisation SQL ↔ core
pnpm db:start             # Supabase local : migrations + seed + comptes de démo
pnpm db:test              # tests SQL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres)
pnpm db:types             # régénère packages/db/src/database.types.ts
```

Sans Docker (Postgres 16+ avec PostGIS) : `PGURL=postgres://postgres:postgres@localhost:5432 pnpm --filter @thiqa/db test:bare`
reconstruit une base jetable avec une émulation minimale de Supabase et lance les tests SQL.

Comptes de démo (mot de passe `thiqa-dev-2026`) : `admin@`, `reviewer@`, `dispatch@`, `tech1@`, `tech2@`, `client@thiqa.local`.

Après toute modification de la trame, des produits ou du catalogue dans `@thiqa/core` : `pnpm db:seed:gen`
(un test échoue si `supabase/seed.sql` n'est pas à jour). Une trame publiée est **immuable** : toute
modification passe par une v2.

### Appliquer une transition (contrat pour les phases suivantes)

```ts
const r = transition(order.status, 'deposit_paid', 'system', { depositPaidAt: new Date() });
if (!r.ok) throw new Error(r.reason);
// même transaction SQL :
//   select set_config('thiqa.event', 'deposit_paid', true);
//   update orders set status = 'paid', deposit_paid_at = now() where id = $1 and lock_version = $2;
// puis exécuter r.effects (notifications, jobs, webhooks, paiement).
```

## Variables d'environnement

Liste complète et commentée dans [`.env.example`](./.env.example). Pour la Phase 0, seules comptent :

| Variable                                                                | Où                                          | Usage                                   |
| ----------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------- |
| `DATABASE_URL`                                                          | local                                       | tests SQL                               |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` | secrets GitHub (environnement `production`) | `supabase db push` sur `main`           |
| `SUPABASE_DB_URL`                                                       | secret GitHub (optionnel)                   | application de `seed.sql` en production |

Sans ces secrets, le job de déploiement est ignoré (les contrôles tournent quand même).

## Ce que contient la Phase 0

| Élément         | Détail                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Machine à états | 18 statuts, 65 transitions, gardes (prix, créneaux, check-in, inspection complète, 3 tentatives de dispatch, 3 essais IA), effets déclarés                                                                                                                                                                   |
| Trame v1        | 163 points / 9 blocs (ADM 17, STR 19, HUM 16, ELE 19, PLB 17, MEN 15, FIN 19, ENV 24, LOC 17), dont 12 répétés par pièce, bruit à 3 horaires en saisie différée                                                                                                                                              |
| Scoring v1.0.0  | Technique (pondération 25/20/20/15/10/10, pénalités orange 10 % / rouge 35 % du bloc, plafond 30 si bloquant), habitabilité (bruit 30, lumière 20, parking 15, accès 15, environnement 20), rentabilité (rendement net / 10 %, correction habitabilité ±15 %), travaux (fourchettes dédoublonnées par poste) |
| Base            | 38 tables, RLS partout, privilèges par colonne, 2FA staff (aal2), vue `technician_missions` sans données client, buckets privés                                                                                                                                                                              |
| SLA             | 9 étapes paramétrables (`sla_policies`), relances dédupliquées, escalades, `sla_breaches`                                                                                                                                                                                                                    |
| Seed            | Marrakech (+ Casablanca, Rabat, Tanger inactives), 3 secteurs, 2 produits actifs, tarifs, 54 postes travaux, paie, 74 modèles de notification                                                                                                                                                                |

## Décisions en attente (Youness)

1. **Tarifs** : pré-achat 1 500 MAD, audit locatif 2 500 MAD, options 250–400 MAD, coefficients surface/type (riad ×1,3, villa ×1,2, > 200 m² ×1,5) — hypothèses à valider.
2. **Catalogue travaux** (54 postes, Marrakech) et **pondérations du scoring** : à relire avec ton expérience terrain ; tout est versionné.
3. **Seuils techniques** : humidimètre (15 % / 25 %), bruit (55 / 70 dB jour, 50 / 65 dB soir), terre 100 Ω, garde-corps 1 m — à confirmer selon ton matériel et les normes NM visées.
4. **Annulation après paiement** : la machine rembourse l'acompte si l'annulation intervient avant le début de la visite ; quel barème CGV (frais retenus, délai) ?
5. **Paie technicien** : 350 MAD (pré-achat) / 500 MAD (locatif) + 10 % + bonus note ≥ 4,8 — à valider.
6. **Secteurs** de Marrakech : contours approximatifs (Guéliz-Hivernage, Médina, Palmeraie), à redessiner.
7. **Modèles IA** : le brief cite Sonnet 4.5 / Haiku 4.5 ; je recommande les versions actuelles (Sonnet 5.5 / Haiku 5.5) — à trancher en Phase 3.
8. **Comptes à ouvrir** : projet Supabase (plan Pro pour la 2FA et pg_cron), CMI, Stripe, Meta WhatsApp Business (modèles à faire approuver), Resend, Twilio, Sentry.
9. **Juridique** : déclaration CNDP (loi 09-08), CGV, mentions — les durées de conservation (rapports 5 ans, photos 2 ans) sont déjà en base.
10. **Dépôt** : Thiqa vit dans `thiqa/` de ce dépôt (à côté du site Expert Réno) ; souhaites-tu un dépôt dédié avant la Phase 1 ?
