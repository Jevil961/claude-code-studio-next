# Claude Code Studio Next

Claude Code Studio Next es un estudio de escritorio multiplataforma basado en Tauri para Claude Code. Está pensado para usuarios que gestionan proveedores, identidades, Skills, servicios MCP, proyectos e historiales de tareas, sin perder de vista el consumo de memoria y la limpieza de procesos.

## Problema Que Resuelve

Claude Code es potente, pero el uso diario puede volverse incómodo cuando la configuración de proveedores, Skills, servicios MCP, historial de proyectos, diagnósticos y procesos de tareas están repartidos en varios lugares. Esta aplicación reúne esas operaciones en un espacio de trabajo de escritorio.

El proyecto también resuelve un problema práctico de rendimiento: los procesos de Claude Code y Node no deberían quedarse abiertos después de terminar una tarea. El runner inicia Claude Code solo cuando hace falta y limpia los procesos relacionados al finalizar.

## Funciones Principales

- Gestión de proveedores y presets de modelos.
- Organización y sincronización de Skills por identidad.
- Gestión de servicios MCP.
- Navegación por proyectos y conversaciones de Claude Code.
- Runner de Claude Code orientado a bajo consumo de memoria.
- Estadísticas de uso con caché.
- Exportación de diagnósticos con rutas, versiones, procesos, recuentos y errores recientes.
- Copias de seguridad automáticas antes de escrituras destructivas.
- Empaquetado de escritorio con Tauri y backend Node oculto.

## Plataformas

El proyecto apunta a Windows, macOS y Linux. La compilación local validada es Windows x64. Los paquetes para macOS Intel, macOS Apple Silicon y Linux se construyen mediante GitHub Actions en runners nativos. ARM64 forma parte de la estrategia de publicación, con builds nativos para macOS ARM64 y soporte de código fuente para otros objetivos ARM64.

## Instalación

Los usuarios deben descargar los paquetes desde GitHub Releases. En Windows se puede usar el instalador o el zip portable. En macOS se usa el DMG. En Linux se puede usar AppImage o paquete Debian cuando esté disponible.

Los paquetes incluyen el runtime del backend de escritorio. Claude Code debe estar instalado; si falta, la aplicación mostrará una guía de configuración. Node.js/npm del sistema aún puede ayudar con actualizaciones npm de Claude Code.

## Desarrollo

```powershell
npm install
npm run dev
```

Validación:

```powershell
npm run check
npm test
cargo check --manifest-path src-tauri\Cargo.toml
```

## Publicación

Los binarios generados no deben subirse al repositorio Git. Deben publicarse en GitHub Releases. El workflow de release compila paquetes nativos al enviar una etiqueta `v*`.

## Estado Actual

La versión `1.0.0` está lista para publicarse en GitHub. Los paquetes incluyen el runtime del backend. La firma de código y las actualizaciones automáticas todavía no están habilitadas.
