# Assistant 1.4.46 / AgentBridge 0.4.21

La stack publiée associe MCP 0.2.20, AgentBridge 0.4.21 et Assistant 1.4.46.
Le manifeste et le fallback intégré à Tigo utilisent les mêmes versions.
Les deux projets restent compatibles avec Convertigo 8.4.6.

- Vibe/Mistral sépare les blocs de raisonnement de la réponse : les dictionnaires `thinking` ne sont plus affichés comme du texte. La configuration des profils GLM gérés est migrée au prochain démarrage.
- Le calcul estimatif de Vibe tient compte du tarif des tokens en cache : 0,14 USD par million pour GLM 5.3 et 0,15 USD pour les modèles Mistral Medium gérés. Un tarif personnalisé explicite est conservé.
- Le popup distingue le contexte avant compaction, le coût estimé des tokens de la session et le quota du compte. Les libellés français et anglais précisent que les frais réels dépendent du forfait et de la facturation du fournisseur.
- L'authentification par clé API ne permet pas de déduire le mode de facturation. Quand le harnais ne fournit pas de quota du compte, l'arc reste neutre. Un coût nul explicite reste visible, même sans compteur de contexte.

Validation dans la vue Assistant native du Studio hotfix 18082 avec le compte
Mistral : « liste les projets » appelle le MCP et retourne 32 projets, sans sortie
`thinking` brute. Le popup affiche 22 076 / 200 000 tokens avant compaction et
un coût estimé de session de 0,1200 USD. L'actualisation ne lance pas de prompt ;
la fermeture par bouton et par Échap fonctionne.

Les tests ciblés Bridge, quota Assistant, contexte natif et installation de stack
passent. La génération/export isolée avec le plugin officiel 8.4.6 et la
compilation production locale passent. La preuve normalisée figure dans
`vibe-mistral-usage-proof.json`.

Le commit porte `[skip deploy]` : la CI construit et publie les CAR sur les pushes
de branche et de tag, sans déploiement de serveur pour cette release.
