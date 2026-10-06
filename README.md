# AZ TECH Maroc

## Lancer la boutique et l’administration

La gestion des produits et des comptes nécessite Node.js 20 ou plus récent. Les mots de passe sont hachés côté serveur, les sessions utilisent un cookie `HttpOnly`, et les comptes ne sont pas enregistrés dans le navigateur.
Par défaut, les données sont enregistrées dans `data/store.json`. `AZ_DATA_DIR` permet à l’hébergeur de les déplacer vers un volume persistant protégé en écriture.

Sur une installation vierge, le premier compte est `admin` / `admin`. Cet accès temporaire est créé une seule fois et doit être remplacé immédiatement après la première connexion : tant qu’il n’a pas été changé, la gestion et les autres API d’administration restent bloquées. Choisir un nouveau mot de passe d’au moins 12 caractères. Ne jamais exposer le serveur ni ouvrir son port sur le réseau avant d’avoir remplacé ce mot de passe. Chaque administrateur peut ensuite modifier son propre mot de passe depuis le bouton « Mon compte ».

Dans PowerShell :

```powershell
npm start
```

Ouvrir ensuite :

- Boutique : `http://localhost:3000/`
- Administration : `http://localhost:3000/admin`

À la première ouverture, le catalogue de démonstration est copié depuis `data/products.json` vers `data/store.json`. Le fichier de données et les comptes sont exclus de Git. Conserver une sauvegarde privée de `data/store.json` avant toute migration ou restauration.

Le serveur écoute uniquement sur `127.0.0.1` par défaut. En production, le placer derrière un proxy TLS qui transmet le trafic au port interne et définir `COOKIE_SECURE=true`. Si le serveur tourne dans un conteneur, définir `HOST=0.0.0.0` uniquement dans son réseau privé, filtrer le port au pare-feu et ne jamais exposer ce port HTTP directement au public. Fournir l’administrateur initial et son mot de passe via un gestionnaire de secrets ou des variables d’environnement gérées par l’hébergeur — jamais dans un fichier public, un dépôt Git ou du code côté navigateur.

Cette première installation est conçue pour un seul processus Node : le catalogue est écrit de manière atomique sur disque et les sessions sont invalidées au redémarrage. Pour plusieurs instances ou une disponibilité sans interruption, connecter une base de données transactionnelle et un magasin de sessions partagé avant de répartir le trafic.

Les administrateurs peuvent créer d’autres admins et des comptes utilisateur, réinitialiser leurs mots de passe, attribuer les permissions « Voir les produits » et « Gérer les produits », et bloquer ou débloquer des comptes. Les admins ne peuvent pas bloquer ou rétrograder le dernier administrateur actif. Les utilisateurs peuvent uniquement accéder aux actions correspondant à leurs permissions ; le serveur revérifie chaque permission.

Les produits ajoutés ou modifiés sont enregistrés dans `data/store.json` et chargés par la boutique. Pour une nouvelle photo, cliquer « Choisir une photo sur cet appareil » dans le formulaire admin : l’image PNG, JPEG, WebP ou GIF (5 Mo maximum) est vérifiée et téléversée directement vers `data/product-images/`, sans saisir d’URL ni de chemin. Son nom aléatoire empêche tout écrasement ; les fichiers sont servis depuis `/uploads/`. Placer `data/` (y compris les images) sur un volume persistant avec accès en écriture et sauvegarder son contenu. Les anciennes valeurs du catalogue initial restent disponibles dans `data/products.json` comme référence, sans écraser les changements enregistrés.

Les commandes existantes via Google Apps Script conservent leur propre catalogue de prix. Après modification des prix ou ajout d’articles, mettre également à jour `ORDER_CATALOG` dans `google_sheets_orders.gs` avant de réactiver le traitement des commandes par Google Sheets.
