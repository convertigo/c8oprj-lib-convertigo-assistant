# TigoAccess — Assistant 1.4.44

Cette release ajoute l’attribution d’une offre Tigo de 10 USD à partir du PSC du Studio, l’affichage des quotas et le lien de demande d’extension manuelle. La stack associe Assistant 1.4.44, AgentBridge 0.4.19 et MCP 0.2.20. Les projets restent compatibles Convertigo 8.4.6 ; le plugin de build est fixé à la version officielle 8.4.6.

## Activation dans le Studio

Le fournisseur Convertigo passe par `AgentSetup`, puis `TigoAccessBootstrap`. Le serveur lit `owner.email` et `studio.secret` depuis le PSC du workspace moteur courant ; aucune valeur fournie par le navigateur ne remplace cette identité ni le chemin de lecture. La session doit être une session Studio authentifiée WEB_ADMIN.

Le connecteur privé appelle `getApiKey(email, secret)` en POST HTTPS sur backend-apps, avec vérification du certificat. TigoAccess valide le PSC auprès du service d’identité, puis retrouve ou provisionne la clé. L’attribution initiale de 10 USD est unique côté backend ; une répétition conserve la clé et les dépenses. La réponse n’utilise pas de JWS.

La clé est installée atomiquement dans `<workspace>/agents/convertigo/llm-api-key`, emplacement utilisé par le Bridge. Les métadonnées adjacentes contiennent le compte et le hash de la clé, jamais le secret PSC. Sur les systèmes POSIX, le répertoire est privé (0700), les fichiers sont privés (0600). Les liens symboliques sont refusés. Les clés et le secret d’identité ne sont jamais retournés à l’interface.

Une clé configurée manuellement est conservée. Un échec d’activation bloque la préparation du fournisseur Convertigo. Le périmètre d’accès à la vue Agent reste celui de la version précédente : stack locale reconnue ou opt-in early access ; cette release ne change pas les règles d’activation de la vue.

## Quota et extensions

`TigoAccessStatus` lit la clé locale et vérifie son hash contre ses métadonnées, puis appelle `getQuota(apiKey)` en POST HTTPS. La consultation fonctionne après redémarrage du Studio, sans cache de session, y compris si la clé est épuisée ou expirée. La clé ne transite pas dans l’interface ni dans l’URL du portail.

La barre de quota distingue les sources :

- Convertigo : budget, dépenses et solde USD provenant de TigoAccess/LiteLLM.
- Codex et Claude : fenêtres de limites rapportées par leur wrapper actif.
- Vibe : usage du contexte et coût éventuel ; ces valeurs ne représentent pas un solde de compte. Un quota absent reste affiché comme indisponible.

Les wrappers sont lus par la séquence privée `agent_quota` du Bridge 0.4.19. L’Assistant choisit son handle côté serveur après vérification du propriétaire de la conversation et du fournisseur. Les lectures ne créent pas de conversation, ne démarrent pas de CLI et n’envoient pas de prompt. Les snapshots ne rejoignent pas les diagnostics ou événements publics du Bridge.

Les changements de fournisseur/conversation invalident les réponses tardives. Une erreur libère le verrou de lecture pour permettre une nouvelle tentative. Les tours actifs peuvent actualiser au maximum toutes les 30 secondes ; aucun polling inactif n’est ajouté.

Le lien **Demander une extension** ouvre le portail TigoAccess sans clé, email, PSC ou token dans l’URL. Le renouvellement est manuel et effectué par un admin ; le lien n’ajoute aucun crédit. Les accès entreprise sont disponibles côté TigoAccess, mais le sélecteur `teamId` dans l’Assistant est différé.

## Configuration

- `assistant.tigo.access.host` : `backend-apps.convertigo.net` par défaut.
- `assistant.tigo.portal_url` : `https://backend-apps.convertigo.net/convertigo/projects/TigoAccess/DisplayObjects/mobile/home` par défaut. Seules les URL HTTPS sans identifiants, query string ou fragment sont acceptées.

Aucun credential de gestion LiteLLM n’est nécessaire dans l’Assistant. Ces credentials restent sur TigoAccess, configurés par symbols serveur.

## Validation de release

Les tests couvrent l’isolation utilisateur/fournisseur/conversation, les réponses tardives, les états épuisé/expiré/indisponible, la distinction contexte/quota et les reprises après échec. Le frontend est construit en production par le MCP hotfix. Les deux projets sont chargés et exportés avec le plugin officiel 8.4.6 dans un répertoire isolé, sans changer les descripteurs du workspace par un outil externe.

Le bootstrap et la consultation du quota ont aussi été revérifiés avec le PSC réel du Studio contre TigoAccess déployé, sans renouvellement ni requête d’inférence. Les preuves contenant des données personnelles et captures réelles restent locales, hors du commit de release.

Pour les tests de quota UI, exporter la Page canonique via MCP, puis fournir ce fichier à `CONVERTIGO_QUOTA_UI_SNAPSHOT` ; exécuter `node --test tests/assistant_*.test.js tests/assistant_*.test.cjs tests/nocode-*.test.cjs`. Les autres tests utilisent les helpers de sources existants. Le snapshot UI de test et les dépendances TypeScript du Mobile Builder doivent être disponibles.
