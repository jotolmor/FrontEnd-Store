const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');

const OPENAI_SECRET_KEY = 'smartCommit.openaiApiKey';
const DEFAULT_MODEL = 'gpt-4.1-mini';
const DEFAULT_MAX_DIFF_CHARS = 12000;

function execGit(args, cwd) {
  return new Promise((resolve, reject) => {
    cp.exec(`git ${args}`, { cwd, maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function execGitFile(args, cwd) {
  return new Promise((resolve, reject) => {
    cp.execFile('git', args, { cwd, maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve((stdout || '').trim());
    });
  });
}

function detectType(changedFiles, diffText) {
  const fileList = changedFiles.map((f) => f.toLowerCase());
  const text = (diffText || '').toLowerCase();

  if (fileList.some((f) => f.includes('test') || f.endsWith('.spec.js') || f.endsWith('.test.js'))) {
    return 'test';
  }
  if (fileList.some((f) => f.includes('readme') || f.includes('docs/') || f.endsWith('.md'))) {
    return 'docs';
  }
  if (fileList.some((f) => f.endsWith('.css') || f.endsWith('.scss')) && !text.includes('function') && !text.includes('const ')) {
    return 'style';
  }
  if (text.includes('fix') || text.includes('bug') || text.includes('error') || text.includes('undefined')) {
    return 'fix';
  }
  if (text.includes('refactor') || text.includes('rename') || text.includes('cleanup')) {
    return 'refactor';
  }
  if (fileList.some((f) => f.includes('package.json') || f.includes('vite.config') || f.includes('webpack') || f.includes('tsconfig'))) {
    return 'chore';
  }
  return 'feat';
}

function detectScope(changedFiles) {
  const folders = changedFiles
    .map((file) => file.split(/[\\/]/).filter(Boolean))
    .filter((parts) => parts.length > 1)
    .map((parts) => parts[0].toLowerCase());

  if (!folders.length) {
    return '';
  }

  const counts = new Map();
  for (const folder of folders) {
    counts.set(folder, (counts.get(folder) || 0) + 1);
  }

  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  return best || '';
}

function buildSummary(changedFiles, diffText) {
  const fileCount = changedFiles.length;
  const cssFiles = changedFiles.filter((f) => /\.(css|scss|less)$/i.test(f)).length;
  const htmlFiles = changedFiles.filter((f) => /\.html?$/i.test(f)).length;
  const jsFiles = changedFiles.filter((f) => /\.(js|ts|jsx|tsx)$/i.test(f)).length;

  if (fileCount === 1) {
    const base = path.basename(changedFiles[0]);
    if (/\.html?$/i.test(base)) return `actualiza ${base}`;
    if (/\.(css|scss|less)$/i.test(base)) return `ajusta estilos en ${base}`;
    if (/\.(js|ts|jsx|tsx)$/i.test(base)) return `actualiza lógica en ${base}`;
    return `actualiza ${base}`;
  }

  if (htmlFiles > 0 && cssFiles > 0 && jsFiles > 0) {
    return 'mejora interfaz y comportamiento de la aplicación';
  }
  if (htmlFiles > 0 && cssFiles > 0) {
    return 'actualiza estructura y estilos de la interfaz';
  }
  if (jsFiles > 0) {
    return 'mejora lógica y manejo de eventos';
  }

  const additions = (diffText.match(/^\+/gm) || []).length;
  const deletions = (diffText.match(/^-/gm) || []).length;

  if (additions > deletions * 2) {
    return 'agrega nueva funcionalidad y ajustes asociados';
  }
  if (deletions > additions * 2) {
    return 'simplifica implementación y elimina código innecesario';
  }

  return `actualiza ${fileCount} archivos relacionados`;
}

function toCommitMessage(changedFiles, diffText) {
  const type = detectType(changedFiles, diffText);
  const scope = detectScope(changedFiles);
  const summary = buildSummary(changedFiles, diffText);
  const prefix = scope ? `${type}(${scope})` : type;
  return `${prefix}: ${summary}`;
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('smartCommit');
  return {
    model: cfg.get('model', DEFAULT_MODEL),
    maxDiffChars: Math.max(2000, cfg.get('maxDiffChars', DEFAULT_MAX_DIFF_CHARS)),
    language: cfg.get('language', 'es'),
    enableCommitActions: cfg.get('enableCommitActions', true)
  };
}

function truncateDiff(diffText, maxChars) {
  if (!diffText) return '';
  if (diffText.length <= maxChars) return diffText;
  return `${diffText.slice(0, maxChars)}\n\n[diff truncated]`;
}

function extractOutputText(responseData) {
  if (typeof responseData?.output_text === 'string' && responseData.output_text.trim()) {
    return responseData.output_text.trim();
  }
  if (!Array.isArray(responseData?.output)) return '';

  const chunks = [];
  for (const item of responseData.output) {
    if (!Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (content?.type === 'output_text' && typeof content?.text === 'string') {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

function normalizeCommitMessage(raw) {
  return (raw || '').trim().replace(/^["'`]+|["'`]+$/g, '');
}

async function generateWithOpenAI({ apiKey, model, files, diffText, language }) {
  const languagePrompt = language === 'en' ? 'English' : 'Spanish';
  const prompt = [
    'Generate exactly one git commit message using Conventional Commits format.',
    `Language: ${languagePrompt}.`,
    'Output only one line with no markdown and no extra explanation.',
    'Prefer scope if obvious.',
    '',
    `Changed files (${files.length}):`,
    files.map((f) => `- ${f}`).join('\n'),
    '',
    'Git diff:',
    diffText || '(no diff available, likely new/untracked files)'
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: prompt,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return normalizeCommitMessage(extractOutputText(data));
}

async function getRepoRoot() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error('No hay una carpeta abierta en VS Code.');
  }

  const cwd = workspaceFolder.uri.fsPath;
  const root = await execGit('rev-parse --show-toplevel', cwd);
  return root;
}

async function gatherChanges(repoRoot) {
  const stagedNames = await execGit('diff --cached --name-only', repoRoot);
  const stagedDiff = await execGit('diff --cached -- .', repoRoot);

  let files = stagedNames.split(/\r?\n/).filter(Boolean);
  let diffText = stagedDiff;
  let source = 'staged';

  if (!files.length) {
    const unstagedNames = await execGit('diff --name-only', repoRoot);
    const unstagedDiff = await execGit('diff -- .', repoRoot);
    files = unstagedNames.split(/\r?\n/).filter(Boolean);
    diffText = unstagedDiff;
    source = 'unstaged';
  }

  if (!files.length) {
    const untracked = await execGit('ls-files --others --exclude-standard', repoRoot);
    files = untracked.split(/\r?\n/).filter(Boolean);
    diffText = '';
    source = 'untracked';
  }

  return { files, diffText, source };
}

async function hasStagedChanges(repoRoot) {
  const staged = await execGit('diff --cached --name-only', repoRoot);
  return staged.split(/\r?\n/).filter(Boolean).length > 0;
}

async function commitWithMessage(repoRoot, message, stageAll) {
  if (stageAll) {
    await execGitFile(['add', '-A'], repoRoot);
  }
  await execGitFile(['commit', '-m', message], repoRoot);
}

async function ensureApiKey(context) {
  let apiKey = await context.secrets.get(OPENAI_SECRET_KEY);
  if (apiKey) return apiKey;

  const choice = await vscode.window.showWarningMessage(
    'No hay API key de OpenAI configurada.',
    'Configurar API key'
  );
  if (choice !== 'Configurar API key') return '';

  await vscode.commands.executeCommand('smartCommit.setApiKey');
  apiKey = await context.secrets.get(OPENAI_SECRET_KEY);
  return apiKey || '';
}

function activate(context) {
  const setApiKeyDisposable = vscode.commands.registerCommand('smartCommit.setApiKey', async () => {
    const value = await vscode.window.showInputBox({
      title: 'OpenAI API Key',
      prompt: 'Ingresa tu API key (se guarda de forma segura en VS Code)',
      password: true,
      ignoreFocusOut: true,
      validateInput: (input) => {
        if (!input || input.trim().length < 20) return 'API key inválida.';
        return null;
      }
    });

    if (!value) return;
    await context.secrets.store(OPENAI_SECRET_KEY, value.trim());
    vscode.window.showInformationMessage('API key guardada correctamente.');
  });

  const disposable = vscode.commands.registerCommand('smartCommit.generateMessage', async () => {
    try {
      const repoRoot = await getRepoRoot();
      const { files, diffText, source } = await gatherChanges(repoRoot);
      const config = getConfig();

      if (!files.length) {
        vscode.window.showWarningMessage('No se detectaron cambios para generar un commit message.');
        return;
      }

      const fallback = toCommitMessage(files, diffText);
      const apiKey = await ensureApiKey(context);

      let candidate = fallback;
      if (apiKey) {
        try {
          candidate = await generateWithOpenAI({
            apiKey,
            model: config.model,
            files,
            diffText: truncateDiff(diffText, config.maxDiffChars),
            language: config.language
          });
          if (!candidate) {
            candidate = fallback;
          }
        } catch (aiError) {
          candidate = fallback;
          vscode.window.showWarningMessage(`OpenAI no respondió correctamente. Se usa fallback local. (${aiError.message})`);
        }
      }

      const quickPick = await vscode.window.showQuickPick(
        [
          {
            label: candidate,
            description: source === 'staged' ? 'Basado en cambios staged' : 'Basado en cambios no staged'
          },
          {
            label: 'Editar manualmente...'
          }
        ],
        {
          placeHolder: 'Selecciona o edita el mensaje generado'
        }
      );

      if (!quickPick) {
        return;
      }

      const initialValue = quickPick.label === 'Editar manualmente...' ? candidate : quickPick.label;
      const finalMessage = await vscode.window.showInputBox({
        value: initialValue,
        prompt: 'Mensaje de commit',
        validateInput: (value) => (value.trim().length < 8 ? 'El mensaje es demasiado corto.' : null)
      });

      if (!finalMessage) {
        return;
      }

      const message = finalMessage.trim();
      if (!config.enableCommitActions) {
        await vscode.env.clipboard.writeText(message);
        vscode.window.showInformationMessage('Mensaje de commit copiado al portapapeles.');
        return;
      }

      const action = await vscode.window.showQuickPick(
        [
          { label: 'Copiar mensaje', value: 'copy' },
          { label: 'Hacer commit (solo staged)', value: 'commitStaged' },
          { label: 'Stage all + commit', value: 'stageAllCommit' }
        ],
        { placeHolder: 'Selecciona la acción a ejecutar' }
      );

      if (!action) {
        return;
      }

      if (action.value === 'copy') {
        await vscode.env.clipboard.writeText(message);
        vscode.window.showInformationMessage('Mensaje de commit copiado al portapapeles.');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        action.value === 'stageAllCommit'
          ? 'Se hará "git add -A" y luego commit. ¿Continuar?'
          : 'Se hará commit con cambios staged. ¿Continuar?',
        { modal: true },
        'Confirmar'
      );
      if (confirm !== 'Confirmar') {
        return;
      }

      if (action.value === 'commitStaged') {
        const staged = await hasStagedChanges(repoRoot);
        if (!staged) {
          vscode.window.showWarningMessage('No hay cambios staged para hacer commit.');
          return;
        }
      }

      await commitWithMessage(repoRoot, message, action.value === 'stageAllCommit');
      vscode.window.showInformationMessage(`Commit creado: ${message}`);
    } catch (error) {
      vscode.window.showErrorMessage(`No se pudo generar el mensaje: ${error.message}`);
    }
  });

  context.subscriptions.push(setApiKeyDisposable);
  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
