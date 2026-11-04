#!/usr/bin/env bash
# Copia a versão nova (pasta extraída do zip) para dentro do seu repositório,
# apagando também os arquivos que a versão nova removeu.
#
# Uso (Git Bash, dentro da pasta do projeto):
#   bash atualizar-do-zip.sh "/c/Users/SEU_USUARIO/Downloads/Pedro.gg-DraftCompanion"
#
# A pasta indicada é a que contém o package.json (extraia o zip antes).
set -euo pipefail

NOVA="${1:-}"
if [ -z "$NOVA" ] || [ ! -f "$NOVA/package.json" ]; then
  echo "Informe a pasta extraída do zip (a que tem o package.json)."
  echo 'Exemplo: bash atualizar-do-zip.sh "/c/Users/SEU_USUARIO/Downloads/Pedro.gg-DraftCompanion"'
  exit 1
fi
cd "$(dirname "$0")"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Rode dentro da pasta do projeto (repositório git)."; exit 1; }
NOVA="$(cd "$NOVA" && pwd)"
[ "$NOVA" = "$(pwd)" ] && { echo "A pasta do zip não pode ser a própria pasta do projeto."; exit 1; }

# Arquivos versionados que a versão nova não tem mais (ex.: componentes removidos).
REMOVER=()
while IFS= read -r f; do
  [ -e "$NOVA/$f" ] || REMOVER+=("$f")
done < <(git ls-files)

echo "Versão nova: $(node -p "require('$NOVA/package.json').version" 2>/dev/null || echo '?')"
if [ ${#REMOVER[@]} -gt 0 ]; then
  echo
  echo "Estes arquivos deixaram de existir na versão nova e serão apagados:"
  printf '  - %s\n' "${REMOVER[@]}"
fi
echo
read -r -p "Aplicar a atualização? [s/N] " ok
[ "$ok" = "s" ] || [ "$ok" = "S" ] || { echo "Cancelado."; exit 0; }

for f in "${REMOVER[@]+"${REMOVER[@]}"}"; do rm -f -- "$f"; done
# copia tudo, menos .git e node_modules (que o zip nem traz)
cp -R "$NOVA"/. .
echo
echo "Pronto. Confira com:  git status"
echo "Depois rode:          bash publicar.sh"
