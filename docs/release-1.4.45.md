# Assistant 1.4.45 / AgentBridge 0.4.20

La stack publiée associe MCP 0.2.20, AgentBridge 0.4.20 et Assistant 1.4.45.
Les versions sont identiques dans le manifeste et le fallback intégré à Tigo.
Le plugin de build reste fixé à Convertigo 8.4.6.

- Le quota apparaît dans un arc cliquable près du modèle. Le popup présente les fenêtres d'utilisation, leur réinitialisation, ou le crédit Tigo et le lien d'extension. Le gris indique un quota inconnu ; les avertissements et limites utilisent orange et rouge.
- Claude fournit ses modèles et niveaux d'effort par le contrôle `initialize` de la CLI authentifiée. Les versions ne sont plus figées dans le Bridge ; le cache est propre au profil utilisateur.
- Codex et Claude peuvent lire le quota avant le premier prompt, sans créer de conversation ni lancer d'inférence. Un processus de métadonnées bref est utilisé si aucun harnais n'est actif ; sa réponse est mise en cache pendant 30 secondes. Un harnais actif est interrogé directement.
- Claude lit `get_usage` et conserve les limites de session, de semaine et de modèle. Les réponses de contrôle et identifiants de compte ne rejoignent jamais les événements publics.
- Les conversations Claude partagent le stockage OAuth de leur utilisateur tout en gardant leurs configurations MCP/viewer séparées. Sur macOS, le service Keychain correspondant au profil est lu avant l'ancien service global.
- Vibe expose l'usage du contexte et le coût ACP séparément. Son absence de quota de compte reste explicite.

Validation locale dans le Studio hotfix 18082 : les trois harnais ont répondu à
« liste les projets » via MCP, avec 32 projets disponibles. Le quota a été vérifié
avant prompt pour Codex (15 % hebdomadaire) et Claude (24 % session, 64 % semaine,
4 % Fable). Vibe a remonté 22 118 / 200 000 tokens de contexte et 0,140142 USD,
sans quota de compte. La session Claude a été reconnectée par l'utilisateur.

Les 77 tests Assistant/NoCode et les 10 tests Bridge passent. Le build production
natif et les générations/exports isolés avec le plugin officiel 8.4.6 passent.
Aucune clé n'a été créée ou renouvelée pendant cette vérification.

Le commit de publication porte `[skip deploy]` : la CI construit et publie les CAR
sur les pushes de branche et de tag, sans déployer de serveur pour cette release.
