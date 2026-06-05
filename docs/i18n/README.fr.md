# Claude Code Studio Next

Claude Code Studio Next est un studio de bureau multiplateforme basé sur Tauri pour Claude Code. Il s'adresse aux utilisateurs qui gèrent plusieurs fournisseurs, identités, Skills, services MCP, projets et historiques de tâches, tout en voulant garder une consommation mémoire prévisible.

## Problème Résolu

Claude Code est puissant, mais son utilisation quotidienne peut devenir difficile lorsque les fournisseurs, les Skills, les services MCP, l'historique des projets, les diagnostics et les processus de tâches sont dispersés. Cette application rassemble ces éléments dans un espace de travail clair.

Le projet traite aussi un problème concret de performance : les processus Claude Code et Node ne doivent pas rester actifs après la fin d'une tâche. Le runner lance Claude Code uniquement lorsque c'est nécessaire, puis nettoie les processus associés.

## Fonctionnalités Principales

- Gestion des fournisseurs et des préréglages de modèles.
- Organisation et synchronisation des Skills par identité.
- Gestion des services MCP.
- Navigation dans les projets et conversations Claude Code.
- Runner Claude Code conçu pour limiter l'usage mémoire.
- Statistiques d'utilisation avec cache.
- Export de diagnostics : chemins, versions, processus, compteurs et erreurs récentes.
- Sauvegardes automatiques avant les écritures destructives.
- Packaging Tauri avec backend Node caché.

## Plateformes

Le projet vise Windows, macOS et Linux. La version Windows x64 est validée localement. Les paquets macOS Intel, macOS Apple Silicon et Linux sont construits par GitHub Actions sur des environnements natifs. La stratégie inclut ARM64, avec une construction native pour macOS ARM64 et une compatibilité source pour les autres cibles ARM64.

## Installation

Les utilisateurs finaux doivent télécharger les paquets depuis GitHub Releases. Sous Windows, utilisez l'installateur ou l'archive portable. Sous macOS, utilisez le DMG. Sous Linux, utilisez AppImage ou le paquet Debian lorsque disponible.

Les builds empaquetés incluent le runtime du backend desktop. Claude Code doit être installé, sinon l'application affichera une aide de configuration; Node.js/npm système peut encore servir aux mises à jour npm de Claude Code.

## Développement

```powershell
npm install
npm run dev
```

Validation :

```powershell
npm run check
npm test
cargo check --manifest-path src-tauri\Cargo.toml
```

## Publication

Les binaires générés ne doivent pas être commis dans Git. Ils doivent être publiés dans GitHub Releases. Le workflow de publication construit les paquets natifs lorsqu'un tag `v*` est poussé.

## État Actuel

La version `1.0.0` est prête pour une publication GitHub. Les builds empaquetés incluent le runtime backend. La signature de code et la mise à jour automatique ne sont pas encore activées.
