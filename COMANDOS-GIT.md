# Comandos do dia a dia (Git Bash)

Abra o **Git Bash** na pasta do projeto (`~/Desktop/pedro.gg`) e use sempre os mesmos comandos, qualquer que seja a versão.

## Jeito fácil (scripts prontos)

1. Baixe o zip novo e **extraia** em qualquer lugar (ex.: Downloads).
2. Copie a versão nova para o projeto (apaga também o que foi removido):

       bash atualizar-do-zip.sh "/c/Users/SEU_USUARIO/Downloads/Pedro.gg-DraftCompanion"

3. Faça backup + envio ao GitHub (lê a versão do `package.json` sozinho):

       bash publicar.sh
       bash publicar.sh "v0.5.5: minha mensagem"     # com mensagem própria

   O script cria a branch `backup-antes-vX.Y.Z`, envia para o GitHub, faz o commit e o push, e **pergunta** se quer criar a tag (que gera o instalador).

## Jeito manual (os mesmos passos, um por um)

    cd ~/Desktop/pedro.gg
    git fetch origin
    git status -sb                       # se aparecer "behind", rode antes: git pull --no-rebase origin main

    # 1) backup do que está publicado (troque X.Y.Z pela versão NOVA)
    git branch backup-antes-vX.Y.Z
    git push origin backup-antes-vX.Y.Z

    # 2) enviar a versão nova
    git add -A
    git status                           # confira a lista
    git commit -m "vX.Y.Z: o que mudou"
    git push origin main

    # 3) gerar o instalador e a atualização automática
    git tag vX.Y.Z
    git push origin vX.Y.Z

## Quando precisar

    git log --oneline -10                # últimos commits
    git branch -a                        # branches (inclui os backups)
    git checkout backup-antes-vX.Y.Z     # olhar um backup (depois: git checkout main)
    git restore .                        # descarta alterações NÃO commitadas (cuidado)

### Se o push for recusado ("rejected ... fetch first")
O GitHub tem algo novo (por exemplo, uma edição feita pelo site):

    git pull --no-rebase origin main
    # se houver conflito num arquivo, me mande a mensagem; para ficar com a SUA versão do arquivo:
    git checkout --ours caminho/do/arquivo && git add caminho/do/arquivo && git commit
    git push origin main

### Dados de meta (coleta)
Não depende do push de código: GitHub > **Actions** > "Atualizar dados de meta" > **Run workflow**.
O segredo `RIOT_API_KEY` (Settings > Secrets and variables > Actions) precisa estar válido (chave de desenvolvimento dura 24 h).

### Se a build do GitHub falhou DEPOIS de criar a tag
Corrija o problema, envie, e **mova a tag** para o commit novo (nenhum instalador foi publicado se a build falhou):

    git add -A && git commit -m "correção"
    git push origin main
    git tag -d vX.Y.Z                    # apaga a tag local
    git push origin :refs/tags/vX.Y.Z    # apaga a tag no GitHub
    git tag vX.Y.Z
    git push origin vX.Y.Z

### Arquivo que sobrou de versão antiga
Copiar o zip por cima **não apaga** arquivos que a versão nova removeu, e eles podem quebrar a build. O `atualizar-do-zip.sh` cuida disso. Manualmente: `git rm caminho/do/arquivo`.
