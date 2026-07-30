# 📦 Mettre Expert Réno dans son PROPRE dépôt GitHub

Aujourd'hui, le site se trouve dans le dossier `expert-reno/` à l'intérieur du
dépôt **Smartbnb**. C'est uniquement pour ne rien perdre pendant la construction.

Voici comment en faire un **projet 100 % indépendant**, dans son propre dépôt
GitHub (sur le compte de ton choix). C'est rapide et sans risque pour Smartbnb.

> ℹ️ La création d'un **compte GitHub** et d'un **dépôt vide** doit être faite par
> toi (je n'ai pas la main sur la création de comptes). Les commandes ci-dessous
> s'occupent du reste.

---

## Étape 1 — Créer le dépôt vide sur GitHub

1. Connecte-toi (ou crée ton nouveau compte) sur <https://github.com>.
2. Clique sur **New repository**.
3. Nomme-le par exemple `expert-reno`.
4. **Ne coche rien** (pas de README, pas de .gitignore, pas de licence) : le dépôt
   doit être **vide**.
5. Valide. GitHub affiche une URL du type :
   `https://github.com/TON-COMPTE/expert-reno.git`

---

## Étape 2 — Récupérer uniquement le dossier du site

Sur ton ordinateur, ouvre un terminal là où tu veux ranger le projet, puis :

```bash
# 1) Récupère le dépôt Smartbnb (s'il n'est pas déjà sur ta machine)
git clone https://github.com/contactsmartbnb-glitch/Smartbnb.git
cd Smartbnb

# 2) Copie le dossier du site ailleurs (hors du dépôt Smartbnb)
cp -r expert-reno ../expert-reno
cd ../expert-reno
```

Tu as maintenant le site seul dans un dossier `expert-reno`, sans rien d'autre.

---

## Étape 3 — En faire un dépôt Git neuf et l'envoyer sur GitHub

Toujours dans le dossier `expert-reno` :

```bash
# Repart d'un historique propre (le dossier n'est plus lié à Smartbnb)
rm -rf .git
git init
git add .
git commit -m "Site Expert Réno & Expert Travaux"
git branch -M main

# Branche le dépôt distant que tu viens de créer (mets TON URL)
git remote add origin https://github.com/TON-COMPTE/expert-reno.git
git push -u origin main
```

✅ C'est fait : Expert Réno vit désormais dans **son propre dépôt**, totalement
séparé de Smartbnb. Tu peux ensuite le brancher à Cloudflare Pages ou Vercel
comme expliqué dans le `README.md` (cette fois, **Root directory** = la racine du
dépôt, plus besoin de pointer vers un sous-dossier `expert-reno`).

---

## (Optionnel) Retirer le dossier du dépôt Smartbnb

Une fois le nouveau dépôt en place et vérifié, si tu veux que `expert-reno`
n'apparaisse plus du tout dans Smartbnb :

```bash
cd Smartbnb
git rm -r expert-reno
git commit -m "Déplacement d'Expert Réno vers son propre dépôt"
git push
```

> ⚠️ Ne fais cette étape qu'**après** avoir confirmé que le nouveau dépôt
> fonctionne, pour ne rien perdre.
