#!/usr/bin/env bash
# Faz o backup do que está publicado e envia a versão nova para o GitHub.
# Serve para QUALQUER versão: ele lê o número em package.json.
#
# Uso (Git Bash, dentro da pasta do projeto):
#   bash publicar.sh                    -> backup, commit, push e (se você quiser) tag
#   bash publicar.sh "mensagem aqui"    -> o mesmo, com a sua mensagem de commit
set -euo pipefail
cd "$(dirname "$0")"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Rode dentro da pasta do projeto (repositório git)."; exit 1; }

VERSAO="$(node -p "require('./package.json').version" 2>/dev/null || sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
[ -n "$VERSAO" ] || { echo "Não consegui ler a versão do package.json."; exit 1; }
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
MSG="${1:-v$VERSAO}"

echo "Versão: $VERSAO   Branch: $BRANCH"
echo

# 1) O GitHub tem algo que você ainda não tem? (ex.: edição feita pelo site)
git fetch origin "$BRANCH" --quiet || { echo "Não consegui falar com o GitHub (internet ou login)."; exit 1; }
ATRAS="$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo 0)"
if [ "$ATRAS" -gt 0 ]; then
  echo "O GitHub tem $ATRAS commit(s) que não estão aqui (edição feita pelo site?)."
  echo "Traga primeiro:   git pull --no-rebase origin $BRANCH"
  echo "Se aparecer conflito, me mande a mensagem. Depois rode este script de novo."
  exit 1
fi

# 2) Backup: uma branch com o estado atual (antes desta versão), enviada ao GitHub também.
BACKUP="backup-antes-v$VERSAO"
if git show-ref --verify --quiet "refs/heads/$BACKUP"; then BACKUP="$BACKUP-$(date +%Y%m%d-%H%M%S)"; fi
git branch "$BACKUP"
git push origin "$BACKUP" --quiet && echo "Backup criado e enviado: $BACKUP"
echo

# 3) Confere se compila ANTES de enviar (é o que a build do GitHub faz; evita tag com erro)
if [ -d node_modules ] && command -v pnpm >/dev/null 2>&1; then
  echo "Conferindo os tipos (pnpm typecheck)..."
  pnpm typecheck || { echo; echo "Há erro de tipos: nada foi enviado. Corrija (ou me mande a mensagem) e rode de novo."; exit 1; }
  echo
fi

# 4) O que vai ser enviado
git add -A
if git diff --cached --quiet; then
  echo "Nada mudou desde o último commit. Nada a enviar."
  exit 0
fi
git status --short
echo
read -r -p "Enviar estas alterações com a mensagem \"$MSG\"? [s/N] " ok
[ "$ok" = "s" ] || [ "$ok" = "S" ] || { echo "Cancelado (o backup continua criado)."; exit 0; }

git commit -m "$MSG"
git push origin "$BRANCH"
echo
echo "Enviado para o GitHub."

# 5) Tag: é ela que gera o instalador e a atualização para os amigos.
echo
if git rev-parse "v$VERSAO" >/dev/null 2>&1; then
  echo "A tag v$VERSAO já existe; não criei outra."
else
  read -r -p "Criar a tag v$VERSAO e gerar o instalador agora? [s/N] " tag
  if [ "$tag" = "s" ] || [ "$tag" = "S" ]; then
    git tag "v$VERSAO"
    git push origin "v$VERSAO"
    echo "Tag v$VERSAO enviada. Acompanhe em: GitHub > Actions."
  else
    echo "Sem tag por enquanto. Quando quiser:  git tag v$VERSAO && git push origin v$VERSAO"
  fi
fi
