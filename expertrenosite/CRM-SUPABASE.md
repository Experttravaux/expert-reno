# 🗂️ CRM Expert Réno — Guide d'installation (pas à pas)

Ce guide met en place, **sans coder**, le CRM du site :

- 📥 chaque demande du **formulaire de contact** est enregistrée dans une base ;
- 🔐 un **tableau de bord privé** (`votre-site.fr/admin`) pour voir et suivre les demandes ;
- 🔄 un **pipeline** : Nouveau → Contacté → Devis envoyé → Gagné / Perdu, avec notes ;
- ✉️ un **email automatique** à chaque nouvelle demande (optionnel, étape 6).

Comptez **15–20 minutes**. Aucune carte bancaire : l'offre gratuite de Supabase suffit.

---

## Étape 1 — Créer un projet Supabase

1. Allez sur <https://supabase.com> → **Start your project** → connectez-vous (compte Google possible).
2. **New project** :
   - *Name* : `expert-reno`
   - *Database Password* : générez-en un et **gardez-le** (vous n'en aurez pas besoin au quotidien).
   - *Region* : choisissez **Europe (West / Paris ou Frankfurt)**.
3. Cliquez **Create new project** et patientez ~2 minutes.

---

## Étape 2 — Créer la base (table des demandes)

1. Dans le menu de gauche : **SQL Editor** → **New query**.
2. Ouvrez le fichier **`supabase/schema.sql`** de ce projet, copiez **tout** son contenu.
3. Collez-le dans l'éditeur, puis cliquez **Run** (en bas à droite).
4. Vous devez voir « Success ». La table `leads` et la sécurité sont créées. ✅

---

## Étape 3 — Récupérer vos 2 clés et les coller dans le site

1. Menu de gauche : **Project Settings** (la roue dentée) → **API**.
2. Notez deux valeurs :
   - **Project URL** → c'est `PUBLIC_SUPABASE_URL`
   - **Project API keys → `anon` `public`** → c'est `PUBLIC_SUPABASE_ANON_KEY`
3. Dans le projet du site, ouvrez le fichier **`.env`** (créez-le depuis `.env.example` s'il n'existe pas) et renseignez :

   ```bash
   PUBLIC_SUPABASE_URL="https://xxxxxxxx.supabase.co"
   PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOi....(longue clé)"
   ```

4. **Sur votre hébergeur** (Cloudflare Pages / Vercel), ajoutez **les mêmes deux variables**
   dans les *Environment variables*, puis **redéployez**.

> 🔒 Ces deux valeurs sont **publiques** et sans danger : la base est protégée par des
> règles de sécurité (RLS) qui empêchent quiconque de lire vos demandes sans être connecté.
> ⚠️ Ne mettez **jamais** la clé `service_role` (secrète) dans le site.

À partir de là, le **formulaire de contact enregistre déjà les demandes** dans Supabase.
Vous pouvez le vérifier dans Supabase → **Table Editor** → table `leads`.

---

## Étape 4 — Créer votre compte administrateur

Le tableau de bord est protégé par email + mot de passe.

1. Supabase → menu **Authentication** → **Users** → **Add user** → **Create new user**.
2. Saisissez **votre email** et **un mot de passe**.
3. Cochez **Auto Confirm User** (pour ne pas avoir à valider par email).
4. Cliquez **Create user**. C'est votre identifiant de connexion au CRM.

---

## Étape 5 — Se connecter au tableau de bord

1. Allez sur **`https://votre-site.fr/admin`** (ou `http://localhost:4321/admin` en local).
2. Connectez-vous avec l'email + mot de passe de l'étape 4.
3. Vous voyez vos demandes, les compteurs, les filtres. Vous pouvez :
   - changer le **statut** d'une demande (menu déroulant) ;
   - cliquer **Voir** pour lire le message, ajouter des **notes**, ou **supprimer**.

> La page `/admin` n'est **pas référencée** par Google (noindex + robots.txt).

---

## Étape 6 — Email à chaque nouvelle demande (optionnel)

Pour être prévenu par email dès qu'un prospect écrit.

### 6.1 — Créer un compte d'envoi (Resend, gratuit)

1. Créez un compte sur <https://resend.com> → **API Keys** → **Create API Key** → copiez la clé (`re_...`).
2. (Recommandé) Vérifiez votre domaine dans Resend pour envoyer depuis `contact@expertreno.fr`.
   Sinon, vous pouvez utiliser l'expéditeur de test `onboarding@resend.dev` au début.

### 6.2 — Déployer la fonction d'envoi

Sur votre ordinateur (une seule fois), avec l'outil Supabase CLI
(<https://supabase.com/docs/guides/cli> — installation expliquée sur leur site) :

```bash
# Se connecter et lier le projet (project-ref = l'identifiant dans l'URL Supabase)
supabase login
supabase link --project-ref VOTRE_PROJECT_REF

# Définir les secrets de la fonction
supabase secrets set RESEND_API_KEY="re_xxxxxxxx"
supabase secrets set NOTIFY_TO="contact@expertreno.fr"
supabase secrets set NOTIFY_FROM="Expert Réno <onboarding@resend.dev>"

# Déployer la fonction (le code est dans supabase/functions/notify-lead/)
supabase functions deploy notify-lead --no-verify-jwt
```

### 6.3 — Déclencher la fonction à chaque nouvelle demande

1. Supabase → **Database** → **Webhooks** → **Create a new hook**.
2. Réglages :
   - *Name* : `notify-lead`
   - *Table* : `leads`
   - *Events* : cochez **Insert**
   - *Type* : **Supabase Edge Functions** → sélectionnez **notify-lead**
3. **Create webhook**.

✅ Désormais, chaque demande déclenche un email. Faites un test depuis le formulaire du site.

---

## Récapitulatif des fichiers

| Fichier | Rôle |
|---|---|
| `supabase/schema.sql` | Crée la table `leads` + la sécurité (à exécuter une fois). |
| `src/components/ContactForm.astro` | Envoie les demandes vers Supabase. |
| `src/pages/admin.astro` | Le tableau de bord privé `/admin`. |
| `supabase/functions/notify-lead/` | La fonction d'email (étape 6). |
| `.env` | Vos 2 clés Supabase (jamais publié sur Git). |

## Problèmes fréquents

- **« CRM non configuré » sur /admin** → les variables `PUBLIC_SUPABASE_*` ne sont pas
  renseignées (ou le site n'a pas été redéployé après les avoir ajoutées).
- **« Email ou mot de passe incorrect »** → vérifiez l'utilisateur créé à l'étape 4
  (et qu'il est bien « confirmé »).
- **Le tableau reste vide** → envoyez une demande test via le formulaire, puis rechargez
  `/admin`. Vérifiez aussi la table `leads` dans Supabase → Table Editor.
- **Pas d'email reçu** → vérifiez les secrets de la fonction et que le webhook (étape 6.3)
  est bien sur l'événement *Insert* de la table `leads`.
