-- ════════════════════════════════════════════════════════════════════
--  Expert Réno — ESPACE CLIENT (suivi de projet + documents sécurisés)
--
--  À exécuter dans Supabase → SQL Editor → New query → coller → Run.
--  Crée : profils (rôle client/pro), projets, étapes, documents,
--  le "coffre" de fichiers (Storage) et toute la sécurité (RLS) :
--  chaque client ne voit QUE ses propres projets et documents.
--
--  Sans danger à relancer.
-- ════════════════════════════════════════════════════════════════════

-- 1) PROFILS : associe chaque compte à un rôle (client par défaut, ou "pro" = vous)
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  nom        text not null default '',
  role       text not null default 'client' check (role in ('client','pro')),
  created_at timestamptz not null default now()
);

-- Crée automatiquement un profil à chaque nouvel inscrit
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, nom) values (new.id, coalesce(new.raw_user_meta_data->>'nom',''))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Fonction utilitaire : l'utilisateur connecté est-il un "pro" (vous) ?
create or replace function public.is_pro()
returns boolean language sql security definer stable as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'pro');
$$;

-- 2) PROJETS
create table if not exists public.projets (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references auth.users on delete cascade,
  titre       text not null default '',
  type        text not null default '',
  adresse     text not null default '',
  statut      text not null default 'en_cours'
              check (statut in ('prepa','en_cours','en_pause','termine')),
  avancement  int  not null default 0,  -- 0 à 100 (%)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists projets_client_idx on public.projets (client_id);

-- 3) ÉTAPES du projet (timeline d'avancement)
create table if not exists public.projet_etapes (
  id          uuid primary key default gen_random_uuid(),
  projet_id   uuid not null references public.projets on delete cascade,
  libelle     text not null,
  ordre       int  not null default 0,
  etat        text not null default 'a_venir' check (etat in ('a_venir','en_cours','termine')),
  date_prevue date
);
create index if not exists etapes_projet_idx on public.projet_etapes (projet_id);

-- 4) DOCUMENTS (métadonnées ; les fichiers eux-mêmes vont dans le Storage)
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  projet_id   uuid not null references public.projets on delete cascade,
  nom         text not null,
  chemin      text not null,            -- emplacement dans le coffre (bucket)
  type        text not null default 'autre' check (type in ('devis','plan','photo','assurance','autre')),
  taille      bigint not null default 0,
  depose_par  text not null default 'pro' check (depose_par in ('client','pro')),
  created_at  timestamptz not null default now()
);
create index if not exists documents_projet_idx on public.documents (projet_id);

-- ════════════════════════════════════════════════════════════════════
--  SÉCURITÉ (RLS) : un client ne voit que SES données ; le "pro" voit tout
-- ════════════════════════════════════════════════════════════════════
alter table public.profiles       enable row level security;
alter table public.projets        enable row level security;
alter table public.projet_etapes  enable row level security;
alter table public.documents      enable row level security;

-- Profils : chacun lit/modifie le sien ; le pro lit tout
drop policy if exists "profiles_self" on public.profiles;
create policy "profiles_self" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_pro());
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Projets : le client voit les siens ; le pro voit/gère tout
drop policy if exists "projets_read" on public.projets;
create policy "projets_read" on public.projets for select to authenticated
  using (client_id = auth.uid() or public.is_pro());
drop policy if exists "projets_pro_all" on public.projets;
create policy "projets_pro_all" on public.projets for all to authenticated
  using (public.is_pro()) with check (public.is_pro());

-- Étapes : visibles si le projet appartient au client (ou pro)
drop policy if exists "etapes_read" on public.projet_etapes;
create policy "etapes_read" on public.projet_etapes for select to authenticated
  using (exists (select 1 from public.projets p where p.id = projet_id
                 and (p.client_id = auth.uid() or public.is_pro())));
drop policy if exists "etapes_pro_all" on public.projet_etapes;
create policy "etapes_pro_all" on public.projet_etapes for all to authenticated
  using (public.is_pro()) with check (public.is_pro());

-- Documents : lecture si le projet est au client (ou pro)
drop policy if exists "documents_read" on public.documents;
create policy "documents_read" on public.documents for select to authenticated
  using (exists (select 1 from public.projets p where p.id = projet_id
                 and (p.client_id = auth.uid() or public.is_pro())));
-- Le client peut DÉPOSER un document sur SON projet
drop policy if exists "documents_client_insert" on public.documents;
create policy "documents_client_insert" on public.documents for insert to authenticated
  with check (depose_par = 'client'
              and exists (select 1 from public.projets p where p.id = projet_id and p.client_id = auth.uid()));
-- Le pro gère tout
drop policy if exists "documents_pro_all" on public.documents;
create policy "documents_pro_all" on public.documents for all to authenticated
  using (public.is_pro()) with check (public.is_pro());

-- ════════════════════════════════════════════════════════════════════
--  COFFRE DE FICHIERS (Storage) : bucket privé "documents"
--  Convention de rangement : <projet_id>/<nom_du_fichier>
-- ════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Lecture d'un fichier : autorisée si le 1er dossier (= projet_id) appartient au client (ou pro)
drop policy if exists "stor_read" on storage.objects;
create policy "stor_read" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (
    public.is_pro()
    or (nullif(split_part(name,'/',1),''))::uuid in (select id from public.projets where client_id = auth.uid())
  ));

-- Dépôt d'un fichier : le client peut écrire dans le dossier de SON projet (le pro partout)
drop policy if exists "stor_insert" on storage.objects;
create policy "stor_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (
    public.is_pro()
    or (nullif(split_part(name,'/',1),''))::uuid in (select id from public.projets where client_id = auth.uid())
  ));

-- Suppression : réservée au pro
drop policy if exists "stor_delete" on storage.objects;
create policy "stor_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.is_pro());
