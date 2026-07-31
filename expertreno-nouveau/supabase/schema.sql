-- ════════════════════════════════════════════════════════════════════
--  Expert Réno — Schéma de base de données CRM (Supabase / PostgreSQL)
--
--  👉 MODE D'EMPLOI (non-développeur) :
--     1. Sur https://supabase.com, ouvrez votre projet
--     2. Menu de gauche : « SQL Editor » → « New query »
--     3. Copiez-collez TOUT ce fichier, puis cliquez sur « Run »
--     Cela crée la table des demandes (« leads ») et la sécurité associée.
--
--  ⚠️ Sans danger à relancer : le script ne casse rien s'il est exécuté 2 fois.
-- ════════════════════════════════════════════════════════════════════

-- Table principale : une ligne = une demande reçue via le site.
create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  -- Coordonnées du prospect
  prenom       text not null default '',
  nom          text not null default '',
  email        text not null default '',
  telephone    text not null default '',

  -- Détails du projet
  type_projet  text not null default '',
  budget       text not null default '',
  message      text not null default '',

  -- Suivi commercial (pipeline)
  statut       text not null default 'nouveau'
               check (statut in ('nouveau','contacte','devis_envoye','gagne','perdu')),
  notes        text not null default '',

  -- Métadonnées
  source       text not null default 'site',   -- d'où vient la demande
  data         jsonb not null default '{}'      -- champs supplémentaires éventuels
);

-- Index pour trier/filtrer rapidement dans le tableau de bord
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_statut_idx     on public.leads (statut);

-- Met à jour automatiquement la date quand le statut/notes changent (optionnel)
alter table public.leads
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════
--  SÉCURITÉ (Row Level Security)
--
--  • Le PUBLIC (clé "anon" du site) peut UNIQUEMENT *créer* une demande.
--    Il ne peut RIEN lire : les coordonnées de vos prospects sont protégées.
--  • Seules les personnes CONNECTÉES (vous, dans le tableau de bord admin)
--    peuvent lire, modifier le statut, ajouter des notes ou supprimer.
-- ════════════════════════════════════════════════════════════════════
alter table public.leads enable row level security;

-- Le public peut INSÉRER une demande (formulaire de contact).
drop policy if exists "public_insert_leads" on public.leads;
create policy "public_insert_leads"
  on public.leads for insert
  to anon, authenticated
  with check (true);

-- Les utilisateurs CONNECTÉS peuvent tout lire.
drop policy if exists "auth_select_leads" on public.leads;
create policy "auth_select_leads"
  on public.leads for select
  to authenticated
  using (true);

-- Les utilisateurs CONNECTÉS peuvent modifier (statut, notes…).
drop policy if exists "auth_update_leads" on public.leads;
create policy "auth_update_leads"
  on public.leads for update
  to authenticated
  using (true) with check (true);

-- Les utilisateurs CONNECTÉS peuvent supprimer.
drop policy if exists "auth_delete_leads" on public.leads;
create policy "auth_delete_leads"
  on public.leads for delete
  to authenticated
  using (true);
