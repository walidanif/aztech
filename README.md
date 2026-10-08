# AZ TECH Maroc

## Lancer la boutique et l’administration

La gestion des produits et des comptes nécessite Node.js 20 ou plus récent. Les mots de passe sont hachés côté serveur, les sessions utilisent un cookie `HttpOnly`, et les comptes ne sont pas enregistrés dans le navigateur.
Par défaut, les données sont enregistrées dans `data/store.json`. `AZ_DATA_DIR` permet à l’hébergeur de les déplacer vers un volume persistant protégé en écriture.

Sur une installation locale vierge, le premier compte est `admin` / `admin`. Cet accès temporaire est créé une seule fois et doit être remplacé immédiatement après la première connexion : tant qu’il n’a pas été changé, la gestion et les autres API d’administration restent bloquées. Choisir un nouveau mot de passe d’au moins 12 caractères. Ne jamais exposer le serveur ni ouvrir son port sur le réseau avant d’avoir remplacé ce mot de passe. Chaque administrateur peut ensuite modifier son propre mot de passe depuis le bouton « Mon compte ».

Dans PowerShell :

```powershell
npm start
```

Ouvrir ensuite :

- Boutique : `http://localhost:3000/`
- Administration : `http://localhost:3000/admin`

À la première ouverture, le catalogue de démonstration est copié depuis `data/products.json` vers `data/store.json`. Le fichier de données et les comptes sont exclus de Git. Conserver une sauvegarde privée de `data/store.json` avant toute migration ou restauration.

Le catalogue de démonstration contient 30 articles, dont une sélection élargie de téléphones. Une mise à niveau versionnée ajoute les nouveaux articles au magasin local ou Supabase déjà initialisé sans remplacer les produits personnalisés, les comptes, les commandes ou l’historique ; elle recalcule aussi les pourcentages de réduction à partir des prix enregistrés. Les prix et la disponibilité sont indicatifs : les confirmer avec l’équipe avant publication commerciale.

Le serveur écoute uniquement sur `127.0.0.1` par défaut. En production, le placer derrière un proxy TLS qui transmet le trafic au port interne et définir `COOKIE_SECURE=true`. Si le serveur tourne dans un conteneur, définir `HOST=0.0.0.0` uniquement dans son réseau privé, filtrer le port au pare-feu et ne jamais exposer ce port HTTP directement au public. Fournir l’administrateur initial et son mot de passe via un gestionnaire de secrets ou des variables d’environnement gérées par l’hébergeur — jamais dans un fichier public, un dépôt Git ou du code côté navigateur.

Cette première installation est conçue pour un seul processus Node : le catalogue est écrit de manière atomique sur disque et les sessions sont invalidées au redémarrage. Pour plusieurs instances ou une disponibilité sans interruption, connecter une base de données transactionnelle et un magasin de sessions partagé avant de répartir le trafic.

Les administrateurs peuvent créer d’autres admins et des comptes utilisateur, réinitialiser leurs mots de passe, attribuer les permissions « Voir les produits » et « Gérer les produits », et bloquer ou débloquer des comptes. Les admins ne peuvent pas bloquer ou rétrograder le dernier administrateur actif. Les utilisateurs peuvent uniquement accéder aux actions correspondant à leurs permissions ; le serveur revérifie chaque permission.

Dans `/admin`, l’onglet « Commandes » permet de consulter et modifier les commandes clients, de les confirmer, les livrer ou les annuler, de filtrer par date, statut, texte et administrateur, et de suivre le nombre de commandes par statut, les confirmations par admin, le chiffre d’affaires livré et le journal d’activité. Les commandes et leur historique sont conservés avec les données du magasin. La synchronisation Google Sheets est facultative et désactivée par défaut ; le guide [`CONFIGURER_GOOGLE_SHEETS.md`](./CONFIGURER_GOOGLE_SHEETS.md) explique comment l’activer.

Les produits ajoutés ou modifiés sont enregistrés dans `data/store.json` et chargés par la boutique. La boutique actualise automatiquement son catalogue après chaque changement et place chaque article dans sa catégorie choisie ; les nouveaux articles sont également mis en avant sur la page d’accueil. Sur mobile, le logo occupe la partie centrale de l’en-tête, le menu latéral présente les catégories, la recherche s’ouvre depuis son icône et le panier permet d’ajuster plusieurs articles avant de finaliser la commande. Pour une nouvelle photo, cliquer « Choisir une photo sur cet appareil » dans le formulaire admin : l’image PNG, JPEG, WebP ou GIF (5 Mo maximum) est vérifiée et téléversée directement vers `data/product-images/`, sans saisir d’URL ni de chemin. Son nom aléatoire empêche tout écrasement ; les fichiers sont servis depuis `/uploads/`. Placer `data/` (y compris les images) sur un volume persistant avec accès en écriture et sauvegarder son contenu. Les anciennes valeurs du catalogue initial restent disponibles dans `data/products.json` comme référence, sans écraser les changements enregistrés.

Les commandes existantes via Google Apps Script conservent leur propre catalogue de prix. Le panier envoie une ligne par article avec la même référence de commande ; le script vérifie chaque identifiant et récupère les prix depuis `ORDER_CATALOG`. Après modification des prix ou ajout d’articles, mettre également à jour `ORDER_CATALOG` dans `google_sheets_orders.gs` avant de réactiver le traitement des commandes par Google Sheets.

## Déploiement sur Vercel

Le dépôt inclut une fonction Vercel pour `/api/*`, les réécritures `/admin` et `/uploads/*`, et un stockage Supabase pour les produits, les comptes, les sessions et les photos. Avant le premier déploiement :

1. Dans le SQL Editor du projet Supabase, exécuter [`supabase/vercel-setup.sql`](./supabase/vercel-setup.sql).
2. Dans les variables d’environnement Vercel du projet AZ TECH, ajouter `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret, jamais côté navigateur) et `ADMIN_INITIAL_PASSWORD`. Choisir un mot de passe initial d’au moins 12 caractères et activer les variables pour l’environnement déployé (Production ou Preview).
3. Redéployer le projet après tout ajout ou changement de variable. Si `/admin` indique que `SUPABASE_URL` ou `SUPABASE_SERVICE_ROLE_KEY` manque, vérifier leurs noms et l’environnement sélectionné dans **Project Settings → Environment Variables**, puis redéployer ; ne jamais coller la clé service-role dans le navigateur ou le dépôt.
4. Ouvrir `/admin`, se connecter avec le nom `admin` et le mot de passe défini par `ADMIN_INITIAL_PASSWORD`, puis le remplacer immédiatement dans « Mon compte ».

Le premier appel initialise le catalogue à partir de `data/products.json`. Les photos sont téléversées directement du navigateur vers le bucket public `product-images` grâce à une URL signée, sans transiter par la fonction Vercel. La boutique actualise son catalogue toutes les 2 secondes sur Vercel (le serveur local conserve les événements instantanés). Le catalogue complet est stocké dans une ligne JSON ; éviter que plusieurs admins modifient des données simultanément. Pour un usage multi-admin intensif, migrer les produits et comptes vers des tables relationnelles avec écritures transactionnelles. N’exécuter le SQL qu’une fois par projet ; il peut être rejoué sans supprimer les données existantes. Garder les clés Supabase uniquement dans les variables secrètes Vercel.
