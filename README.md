# Expert Réno & Expert Travaux — Site web

Site vitrine des deux marques :

- **Expert Réno** — conseil & assistance à maîtrise d'ouvrage (AMO)
- **Expert Travaux** — entreprise générale de bâtiment, tous corps d'état

Construit avec **Astro** + **Tailwind CSS**. Site statique, rapide, responsive et
optimisé pour le référencement (SEO), notamment local à Toulouse.

> 💡 Ce guide est écrit pour une personne **non-développeuse**. Suivez les étapes
> dans l'ordre, en copiant-collant les commandes.

> 📦 **Vous voulez ce site dans son propre dépôt GitHub** (séparé de Smartbnb) ?
> Suivez le guide **[`CREER-DEPOT-SEPARE.md`](./CREER-DEPOT-SEPARE.md)**.

> 🗂️ **CRM (suivi des demandes)** : le formulaire enregistre les contacts dans une
> base Supabase, consultables sur la page privée **`/admin`** (pipeline + notes +
> email d'alerte). Installation pas-à-pas : **[`CRM-SUPABASE.md`](./CRM-SUPABASE.md)**.

> 🟢 **Identité visuelle** : palette vert forêt + accent ocre, reprise du logo.
> Couleurs modifiables dans `tailwind.config.mjs`. Pour mettre **votre logo**,
> voir la section [Ajouter vos photos](#6-ajouter-vos-photos).

---

## 📑 Sommaire

1. [Ce dont vous avez besoin](#1-ce-dont-vous-avez-besoin)
2. [Lancer le site sur votre ordinateur (local)](#2-lancer-le-site-en-local)
3. [Modifier les textes, les services et les projets](#3-modifier-le-contenu)
4. [Brancher le formulaire de contact à un CRM](#4-brancher-le-formulaire-à-un-crm)
5. [Configurer la prise de rendez-vous et les statistiques](#5-rendez-vous--statistiques)
6. [Ajouter vos photos](#6-ajouter-vos-photos)
7. [Mettre le site en ligne (déploiement)](#7-déploiement)
8. [Rebrancher votre domaine expertreno.fr](#8-brancher-le-domaine-expertrenofr)
9. [Aide-mémoire des commandes](#9-aide-mémoire)

---

## 1. Ce dont vous avez besoin

- **Node.js version 20 ou plus.** Téléchargez-le sur <https://nodejs.org> (bouton
  « LTS »). Installez-le comme un logiciel classique.
- Un éditeur de texte gratuit recommandé : **Visual Studio Code**
  (<https://code.visualstudio.com>).

Pour vérifier que Node.js est installé, ouvrez un **terminal** et tapez :

```bash
node --version
```

Vous devez voir un numéro qui commence par `v20` (ou plus).

---

## 2. Lancer le site en local

« En local » = sur votre ordinateur, pour voir le site avant de le publier.

1. Ouvrez un terminal **dans le dossier `expert-reno`**.
2. Installez les dépendances (à faire **une seule fois**) :

   ```bash
   npm install
   ```

3. Lancez le site :

   ```bash
   npm run dev
   ```

4. Ouvrez votre navigateur à l'adresse affichée, généralement :
   <http://localhost:4321>

Le site se met à jour **automatiquement** dès que vous enregistrez une
modification. Pour arrêter, appuyez sur `Ctrl + C` dans le terminal.

---

## 3. Modifier le contenu

Vous pouvez tout modifier **sans toucher au code des composants**. Les fichiers à
éditer sont regroupés et commentés en français.

### a) Coordonnées, réseaux sociaux, chiffres-clés, menu

👉 Fichier : **`src/data/site.ts`**

On y modifie :

- le téléphone, l'email, le WhatsApp ;
- les liens Instagram / LinkedIn / X (Twitter) ;
- les zones d'intervention ;
- les **chiffres-clés** affichés sur l'accueil ;
- les libellés du **menu**.

Ne changez que le texte **entre les guillemets** `" "`.

### b) Les services

👉 Dossier : **`src/content/services/`** (un fichier `.md` par service)

Chaque fichier commence par une zone entre `---` (les informations : titre,
résumé, marque, points-clés, SEO), suivie du texte de la page.

- `marque: "travaux"` → service rattaché à **Expert Travaux**
- `marque: "reno"` → service rattaché à **Expert Réno**

Pour **ajouter un service**, dupliquez un fichier existant et changez son contenu.

### c) Les projets / réalisations

👉 Dossier : **`src/content/projets/`** (un fichier `.md` par projet)

On y renseigne le titre, le résumé, la liste des **travaux**, le **budget**,
l'**ameublement** (optionnel), les **délais**, et la **galerie photo**.

Pour **ajouter un projet**, dupliquez un fichier existant.

### d) Les couleurs et les polices

👉 Fichier : **`tailwind.config.mjs`** (section « PALETTE » commentée).

---

## 4. Brancher le formulaire à un CRM

Par défaut, le formulaire de contact est **prêt** mais n'envoie encore nulle part.
Aucune clé secrète n'est dans le code : tout passe par une **variable
d'environnement**.

### Étapes

1. Dans le dossier `expert-reno`, **copiez** le fichier `.env.example` et
   renommez la copie en **`.env`**.
2. Choisissez un service de formulaire (le plus simple : **Formspree**) :
   - Créez un compte sur <https://formspree.io>
   - Créez un nouveau formulaire : il vous donne une URL du type
     `https://formspree.io/f/abcdefgh`
3. Dans votre fichier `.env`, collez cette URL :

   ```bash
   PUBLIC_FORM_ENDPOINT="https://formspree.io/f/abcdefgh"
   ```

4. Relancez `npm run dev` (ou redéployez). C'est tout : les messages arrivent
   désormais dans votre service.

> Le même principe fonctionne avec **Brevo (Sendinblue)** ou **HubSpot Forms** :
> il suffit de coller l'URL de leur webhook / endpoint à la place. Le formulaire
> envoie les champs (prénom, nom, email, téléphone, type de projet, budget,
> message) au format JSON.

⚠️ Le fichier `.env` ne doit **jamais** être publié (il est déjà ignoré par Git).
Sur Vercel / Cloudflare, vous renseignez ces variables dans leur **interface**
(voir section 7).

---

## 5. Rendez-vous & statistiques

Toujours dans le fichier **`.env`** :

### Bouton « Réserver un créneau »

```bash
PUBLIC_BOOKING_URL="https://calendly.com/votre-compte/decouverte"
```

Fonctionne avec **Calendly** ou **Cal.com**. Si vous laissez vide, le bouton
renvoie simplement vers la page Contact.

### Statistiques (Google Analytics)

```bash
PUBLIC_GA_ID="G-XXXXXXXXXX"
```

Collez votre identifiant Google Analytics 4. Si vous laissez vide, **aucun**
script de suivi n'est chargé (aucun cookie).

> Pour **Google Search Console**, le plus simple est de valider votre site via
> votre fournisseur de domaine (DNS) ou via Google Analytics, sans modifier le
> code.

---

## 6. Ajouter vos photos

👉 Dossier : **`public/images/`**

- Photos de chantier : placez-les dans `public/images/projets/`. Les noms de
  fichiers doivent correspondre à ceux indiqués dans les fiches projets
  (`src/content/projets/`).
- Image de partage social (aperçu sur WhatsApp/LinkedIn) : remplacez
  `public/images/og-expertreno.jpg` par une image **1200 × 630 px**.

Tant qu'une photo n'est pas présente, un cadre « Photo à insérer » s'affiche.
Voir le fichier `public/images/README.md` pour le détail.

### Mettre votre logo

Un logo provisoire (monogramme « ER » façon enso, aux couleurs de votre logo) est
affiché. Pour utiliser **votre fichier** :

1. Déposez votre logo dans `public/` (par ex. `public/logo.svg` ou `public/logo.png`),
   idéalement avec un **fond transparent**.
2. Dans `src/components/Header.astro`, remplacez le bloc `<svg>…</svg>` du logo par :
   `<img src="/logo.svg" alt="Expert Réno" class="h-11 w-auto" />`
   (un commentaire à cet endroit vous le rappelle).
3. Remplacez aussi `public/favicon.svg` par votre icône si vous le souhaitez.

---

## 7. Déploiement

Construire la version finale du site :

```bash
npm run build
```

Le site optimisé est généré dans le dossier **`dist/`**. C'est ce dossier qui est
mis en ligne. Pour le prévisualiser localement :

```bash
npm run preview
```

### Option A — Cloudflare Pages (recommandé, gratuit)

1. Mettez ce projet sur **GitHub** (déjà fait si vous lisez ceci dans le dépôt).
2. Allez sur <https://dash.cloudflare.com> → **Workers & Pages** → **Create** →
   **Pages** → **Connect to Git**.
3. Sélectionnez votre dépôt, puis renseignez :
   - **Framework preset** : `Astro`
   - **Build command** : `npm run build`
   - **Build output directory** : `dist`
   - **Root directory** : `expert-reno` *(important : le site est dans ce
     sous-dossier)*
4. Dans **Settings → Environment variables**, ajoutez vos variables :
   `PUBLIC_SITE_URL`, `PUBLIC_FORM_ENDPOINT`, `PUBLIC_BOOKING_URL`,
   `PUBLIC_GA_ID`.
5. Cliquez sur **Save and Deploy**. À chaque modification envoyée sur GitHub, le
   site se redéploie tout seul.

### Option B — Vercel (gratuit)

1. Allez sur <https://vercel.com> → **Add New** → **Project** → importez votre
   dépôt GitHub.
2. Réglez **Root Directory** sur `expert-reno`. Le reste est détecté
   automatiquement (le fichier `vercel.json` est déjà fourni).
3. Ajoutez les mêmes **variables d'environnement** dans **Settings →
   Environment Variables**.
4. Cliquez sur **Deploy**.

---

## 8. Brancher le domaine expertreno.fr

Vous possédez déjà le domaine. Une fois le site déployé :

### Sur Cloudflare Pages

1. Dans votre projet Pages → **Custom domains** → **Set up a custom domain**.
2. Entrez `www.expertreno.fr` (et/ou `expertreno.fr`).
3. Suivez les instructions : Cloudflare vous indique l'enregistrement DNS à créer
   chez votre fournisseur de domaine (un **CNAME** vers l'adresse fournie). Si
   votre domaine est déjà géré par Cloudflare, la configuration est automatique.

### Sur Vercel

1. Dans votre projet → **Settings → Domains** → ajoutez `www.expertreno.fr`.
2. Vercel affiche l'enregistrement DNS à créer chez votre registrar (un **CNAME**
   ou un **A**). Ajoutez-le, patientez quelques minutes, et le certificat HTTPS
   se met en place automatiquement.

> Pensez à mettre `PUBLIC_SITE_URL="https://www.expertreno.fr"` dans les variables
> d'environnement pour que le sitemap et les liens de partage utilisent la bonne
> adresse.

---

## 9. Aide-mémoire

| Commande          | Ce qu'elle fait                                  |
| ----------------- | ------------------------------------------------ |
| `npm install`     | Installe les dépendances (une seule fois)        |
| `npm run dev`     | Lance le site en local (développement)           |
| `npm run build`   | Génère la version finale dans `dist/`            |
| `npm run preview` | Prévisualise la version finale en local          |

### Où modifier quoi ?

| Je veux changer…                  | Fichier / dossier                  |
| --------------------------------- | ---------------------------------- |
| Téléphone, email, réseaux, menu   | `src/data/site.ts`                 |
| Un service                        | `src/content/services/`            |
| Un projet                         | `src/content/projets/`             |
| Les couleurs / polices            | `tailwind.config.mjs`              |
| Les photos                        | `public/images/`                   |
| Le formulaire / RDV / analytics   | `.env` (voir `.env.example`)       |

---

Bon lancement ! 🚀
