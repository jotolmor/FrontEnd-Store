# Smart Commit Message (VS Code Extension)

Genera mensajes de commit inteligentes a partir de tus cambios en Git usando OpenAI.

## Características

- Analiza cambios `staged`, `unstaged` o archivos nuevos (`untracked`).
- Genera mensaje con IA en formato Conventional Commits.
- Permite editar el mensaje antes de usarlo.
- Permite copiar el mensaje o ejecutar commit directamente.
- Tiene fallback local heurístico si la API falla.

## Configuración inicial

1. Abre la carpeta del repositorio Git en VS Code.
2. Ejecuta el comando:
   - `Smart Commit: Configurar OpenAI API Key`
3. Pega tu API key.

La key se guarda usando `SecretStorage` de VS Code.

## Uso

1. Ejecuta:
   - `Smart Commit: Generar mensaje`
2. Selecciona la sugerencia o edítala.
3. Elige una acción:
   - Copiar mensaje
   - Hacer commit (solo staged)
   - Stage all + commit

## Settings disponibles

- `smartCommit.model` (default: `gpt-4.1-mini`)
- `smartCommit.language` (`es` o `en`)
- `smartCommit.maxDiffChars` (default: `12000`)
- `smartCommit.enableCommitActions` (default: `true`)
  - `true`: permite copiar o ejecutar commit desde la extensión
  - `false`: solo copia el mensaje al portapapeles

## Desarrollo local

1. Abre `vscode-smart-commit` como proyecto en VS Code.
2. Ejecuta `F5` para abrir una ventana Extension Development Host.
3. En esa ventana, abre cualquier repositorio Git y usa el comando.

## Empaquetar

```bash
npm install -g @vscode/vsce
cd vscode-smart-commit
vsce package
```
