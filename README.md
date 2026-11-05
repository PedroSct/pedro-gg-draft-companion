# Pedro.gg Draft Companion

Analista de draft em tempo real para League of Legends. Lê a seleção de campeões pelo cliente local, cruza com a
Champion Pool de cada amigo e mostra o melhor pick, a build e a ordem de habilidades. Depois da partida, analisa o seu
jogo. O app só **lê** do cliente; a única coisa que ele envia é o "Aceitar" da partida encontrada, e só se você ligar
essa opção.

## Rodar em desenvolvimento

O projeto usa **pnpm** (o `npm` tem um bug com as peças nativas do Vite/rolldown no Windows).

    npm install -g pnpm      # só uma vez (ou: corepack enable)
    pnpm install
    pnpm dev                 # abre o app com recarga automática
    pnpm typecheck
    pnpm test

Abra o League of Legends e entre numa seleção de campeões: o indicador do topo vai de "Procurando o LoL" para
"Conectado ao cliente". Se a pasta do jogo não for achada sozinha, use Configurações > Escolher pasta.

## O que o app faz

- **Draft ao vivo**: times, bans, melhor pick da Pool, alternativas, build e ordem de habilidades.
- **Prioridade da sugestão**: *Equilibrado*, *Conforto* (favorece o que você domina) ou *Meta* (favorece os números).
- **Confrontos, sinergia e risco**: winrate contra os inimigos já escolhidos, ganho de winrate com os aliados já
  escolhidos e um aviso de **risco de counter** quando o inimigo ainda pode pegar alguém que vence o seu pick.
- **Composição dos times**: dano físico x mágico e frontline, com aviso (ex.: "dano inimigo quase todo mágico").
- **Pools por rota** com filtros: *Só da rota* (padrão) ou *Todos*, mais filtros de **rota**, **classe** (Lutador,
  Tanque, Mago...) e **função** (Encantador, Mergulhador, Artilharia...). A tabela de rotas/funções fica em
  `src/shared/championMeta.ts`; campeão novo que ainda não está nela aparece em todas as rotas.
- **Compartilhar Pool**: em *Pools* use **Compartilhar esta Pool** (gera um código `PGG1:...` ou um arquivo) e
  **Importar de um amigo** (cole o código ou abra o arquivo). Ao importar você escolhe entre criar um perfil novo,
  juntar (só acrescenta o que falta, sem mexer no seu conforto) ou substituir. Nada é salvo até clicar em *Salvar perfil*.
  Anotações só vão se você marcar a opção.
- **Aceitar partida automaticamente** (opcional, desligado por padrão): botão no topo ou em *Configurações*. Quando a
  partida é encontrada, o app aceita pelo próprio cliente do LoL, sem ler a tela e sem mexer no mouse (funciona com o
  cliente minimizado). Há uma espera configurável (0 a 8 s). Se você aceitar, recusar ou desligar antes, ele não faz nada.
  Substitui o script Python de leitura de tela. É a única escrita que o app faz no cliente, e o caminho é fixo no código.
- **Pós-jogo**: ao terminar a partida, o app lê o resultado e a timeline no cliente (sem chave da Riot) e mostra nota e
  conceito, radar (farm, rota, lutas, visão, objetivos, sobrevivência), dicas em português, CS e ouro minuto a minuto
  contra o oponente de rota, diferença em 10/15/20 min, viradas de ouro, mortes por fase, objetivos e placar. Guarda as
  últimas 40 partidas. O botão **Analisar última partida** busca a mais recente do histórico do cliente. As notas usam
  referências aproximadas (CS/min e visão por rota) e são um ponto de comparação, não uma verdade.
- **Conta e amigos automáticos**: o app lê a conta logada no cliente e, na seleção de campeões, reconhece os amigos
  pelo **Riot ID** salvo no perfil deles (o app guarda o puuid sozinho depois, então vale mesmo se o nome mudar). Cada
  amigo reconhecido ganha as próprias sugestões ("Sugestões para: Você · Caio · …"), com a Pool e a rota dele. Não existe
  mais o seletor "Quem está jogando": em *Pools*, o botão **Esta conta é este perfil** liga a sua conta ao seu perfil.
  O puuid nunca vai no código de compartilhamento.
- **Importar para o cliente** (opcional, por partida): no painel da build, **Importar para o cliente** coloca as runas
  (página "Pedro.gg", só ela é alterada), os feitiços (durante a seleção) e/ou um conjunto de itens "Pedro.gg" no cliente.
  Só acontece ao clicar e só no que estiver marcado. Precisa de runas/feitiços no `meta.json` (o gerador novo coleta);
  sem eles o botão explica o que falta. Caminhos escritos: `/lol-perks/v1/pages`, `/lol-perks/v1/currentpage`,
  `/lol-champ-select/v1/session/my-selection` e `/lol-item-sets/v1/item-sets/{id}/sets`.
- **Aba Meta**: ranking de campeões por rota (tier), melhores e piores confrontos, sinergias, runas, ordem de habilidades
  e itens, tudo a partir do `meta.json`.
- **Pools**: filtros recolhidos atrás de "Filtros", pool agrupada por conforto (Main, Muito bom...), anotações sob demanda
  e, na conta vinculada, nível e elo Solo/Duo lidos do cliente.
- **Mais dados (0.5.1)**: a coleta junta vários servidores e passa a guardar o **tipo de dano real** (físico/mágico/verdadeiro),
  **tanque** e **CC** de cada campeão, o desempenho contra **cada campeão inimigo** (em qualquer rota) e as **construções
  alternativas** mais usadas nas vitórias. Rode o workflow de novo para gerar esses campos (os dados antigos continuam
  funcionando, só sem eles).
- **Recomendação por composição (0.5.1)**: além de winrate, confronto de rota e sinergia, o pick considera o **equilíbrio
  de dano físico/mágico** do seu time, **frontline**, **CC** e o desempenho contra os **outros inimigos** (não só o da
  rota). Cada sugestão mostra o motivo ("traz dano mágico que o time não tem").
- **Build para a partida (0.5.1)**: no painel de build aparece "Para esta partida": o dano do time inimigo, o foco
  (armadura, resistência mágica ou penetração), os itens do próprio campeão que atendem a esse foco e qual construção
  alternativa encaixa melhor.
- **Meta mais completa (0.5.2)**: o ranking ordena por Tier, Vitórias, Presença ou Jogos (clique no cabeçalho), filtra por
  tier e esconde campeões de amostra pequena. A build tem **várias opções** como no OP.GG (runas, feitiços, ordem de
  habilidades, itens iniciais, botas e itens principais) com **% de escolha e % de vitória** de cada uma, contando
  vitórias e derrotas. Campeões com poucos confrontos na rota usam o desempenho contra o campeão em qualquer rota. Quem
  tem sequência de habilidades incomum (Aphelios, Jayce, Udyr, Zeri) deixou de ficar sem build.
- **Sugestões de banimento (0.5.2)**: durante a fase de bans, o painel lista quem mais atrapalha os campeões de conforto
  alto (4 e 5) de você e dos amigos reconhecidos, e quem está forte no meta, com o motivo de cada um.
- **Região dos dados (0.5.2)**: em Configurações > Dados escolha **Global** (todas as regiões somadas, mais partidas e mais
  precisão) ou só BR, EUW ou KR. O workflow publica `meta.json` (global) e `meta-<região>.json` na branch `data`.
- **Janela redimensionável (0.5.2)**: o cabeçalho encolhe, o draft empilha as colunas e os perfis se reorganizam em
  janelas estreitas (mínimo 760 × 560).
- **Pick travado e envio para o LoL (0.5.3)**: ao travar o campeão, as sugestões somem e ficam só ele e a build. O bloco
  **Enviar para o LoL** fica no topo da build e envia ao cliente a **opção que estiver marcada** de runas, feitiços,
  itens iniciais, botas e itens principais (clique numa opção para trocar). Cria/atualiza a página de runas e o conjunto
  de itens "Pedro.gg" e troca os feitiços (estes só durante a seleção). Só age quando você clica.
- **Aceite automático (0.5.3)**: depois de uma partida em que outro jogador não aceitou, o app passa a reconhecer a
  janela seguinte e aceita de novo.
- **Pools como tela (0.5.4)**: "Pools" agora é uma aba do menu, igual a Meta e Pós-jogo (não abre mais por cima de tudo).
  Perfis viram abas, os dados do perfil ficam recolhidos até você querer editar, e o app avisa se você tentar sair com
  alterações não salvas.
- **Tutorial de primeira vez (0.5.4)**: um passo a passo destacando os botões do app, mostrado só na primeira abertura.
  Para ver de novo: Configurações > Geral > Rever tutorial.
- **Counters do meta (0.6.0)**: no draft, um cartão lista os melhores picks do meta **fora da sua Pool** contra o inimigo
  da sua rota (com o winrate do confronto e o número de jogos) e um botão **Adicionar à Pool** (entra com conforto 1).
- **Palpite de rota (0.6.0)**: quando a fila não informa a sua rota, o app tira as rotas que os aliados já ocupam e usa a
  Pool e as rotas principais do perfil. O botão da rota aparece tracejado como "palpite"; clique para confirmar ou troque.
- **Evolução no Pós-jogo (0.6.0)**: nova aba com nota ao longo do tempo, vitórias, desempenho por campeão e por rota e
  padrões de erro (mais mortes nas derrotas, jogos curtos ou longos perdidos), sempre com o número que gerou a dica.
- **Mudanças de patch (0.6.0)**: quando o patch dos dados muda, uma faixa mostra o que mexeu nos campeões das suas Pools
  (tier, winrate e primeiro item da build). Aparece uma vez por patch; **Entendi** dispensa.
- **Backup dos perfis (0.6.0)**: Configurações > Aplicativo > Backup dos perfis salva todos os perfis e Pools em um
  arquivo e restaura em outro PC (mesmo código atualiza, novos são adicionados, nada é apagado).
- **Diagnóstico melhor (0.6.0)**: o relatório traz versão, dados de meta, região e último aceite; dá para **salvar em
  arquivo** e **testar a conexão com o cliente** (mostra quais endpoints respondem).
- **Draft com rolagem (0.6.0)**: a coluna do meio agora rola, então runas, itens e feitiços que serão enviados ao LoL
  ficam sempre visíveis depois de travar o campeão.
- **Menor e mais rápido (0.6.0)**: o código da tela passou a ser minificado (de 666 kB para 280 kB no pacote principal).
- **Builds mais fiéis (0.7.0)**: os mesmos 3 itens comprados em ordens diferentes agora contam como a mesma build (antes
  se dividiam e a opção "mais usada" era quase aleatória com poucas partidas). O padrão da build passou a ser a opção
  mais jogada por todos os jogadores, e não uma mistura dos itens mais frequentes nas vitórias. Quando a build vem de
  menos de 40 partidas com timeline, o app avisa "Poucos dados". Rode o workflow de novo para aplicar (o progresso
  guardado é reaproveitado).
- **Overlay no jogo (0.7.0)**: um painel pequeno, transparente e que **não recebe cliques** aparece num canto da tela durante
  a partida (Summoner's Rift) e mostra **qual habilidade subir agora** (pela ordem da build, corrigindo se você fugiu dela)
  e **os itens da build** na ordem de compra, com o próximo destacado e os já comprados marcados. Ele só **lê** os dados
  da própria partida pela Live Client Data API oficial da Riot (o que você já vê na tela): não automatiza nada, não clica,
  não mostra informação escondida e não mexe no processo do jogo (mesma ideia do Blitz/Porofessor). Liga em Configurações >
  Partida > "Overlay no jogo" (canto e opacidade ajustáveis, botão **Testar o overlay**). Só aparece com o LoL em **janela
  ou sem bordas**; em tela cheia exclusiva o Windows não deixa nada por cima. Se ele não aparecer, o relatório de diagnóstico (Configurações > Aplicativo) tem uma linha "Overlay:" dizendo o motivo.
- **Mais elos na coleta (0.7.0)**: o gerador aceita `--tiers challenger,grandmaster,master,diamond,emerald` (padrão do
  workflow; `platinum` também existe) e `--entry-pages <n>` (padrão 3 páginas de ~200 jogadores por divisão). Resultados
  anteriores são retomados e os elos novos entram no meio dos jogadores que faltam. Mais jogadores e elos variados dão
  builds mais próximas das de OP.GG/Lolalytics.
- **Coleta pós-patch mais rápida (0.7.0)**: logo após um patch novo, as partidas do patch antigo eram baixadas e jogadas
  fora (cerca de 14 requisições por partida válida). Agora o coletor descobre a data em que o patch começou e para de
  pedir partidas mais antigas daquele jogador.
- **Overlay mais fácil de diagnosticar e coleta com tempo limite (0.7.1)**: o relatório de diagnóstico ganhou a linha "Overlay:" com o
  motivo de ele não aparecer, o overlay também funciona na Ferramenta de Treino, e o coletor de dados para sozinho antes
  do limite de 350 min do GitHub (`--max-minutes`), gerando o arquivo com o que já coletou.
- **Correções de estabilidade**: gravação do pós-jogo em fila segura, aviso falso de counter desligado quando o inimigo
  da rota já está confirmado, e download de dados sem redirecionamento inseguro.
- **Visual**: cabeçalho integrado à barra da janela, animação de abertura (dá para desligar), cantos arredondados,
  menos movimento opcional e telas pesadas carregadas só quando abertas.
- **Configurações** em seções (Geral, Partida, Dados, Aplicativo), com o relatório de diagnóstico para copiar.
- **Aviso de meta desatualizado**: se o patch dos dados de builds for mais antigo que o do jogo, aparece uma faixa com
  **Atualizar dados**.
- **Aviso de atualização**: quando existe uma versão nova, aparece uma faixa no topo com **Atualizar agora** / **Depois**.
  O app só baixa se você aceitar e só reinicia quando você clicar (fica travado durante uma seleção de campeões).

## Gerar o instalador (um único .exe)

**Opção A, no seu PC com Windows**

    pnpm install
    pnpm build:win       # cria dist/Pedro.gg-Setup-<versão>.exe

**Opção B, sem configurar nada (GitHub Actions)**
Suba o projeto para um repositório **público** no GitHub, abra a aba *Actions*, escolha *Instalador do Windows* e clique em
*Run workflow*. O `.exe` aparece em *Artifacts*.

O instalador não pede administrador, e desinstalar não apaga perfis nem Pools. Sem certificado de assinatura, o Windows
mostra "O Windows protegeu seu PC": clique em *Mais informações* e *Executar assim mesmo*.

## Publicar uma atualização para os amigos

O app procura versões novas nos *Releases* do GitHub do projeto (ao abrir e a cada 4 horas). Para lançar uma:

1. Mude `"version"` no `package.json` (ex.: `0.5.4`) e faça commit/push.
2. Crie a tag com o mesmo número e envie: `git tag v0.5.4` e `git push origin v0.5.4`.
3. O GitHub Actions gera o instalador e cria o Release (`.exe`, `latest.yml` e `.blockmap`).
4. Quem já tem o app instalado vê o aviso "A versão 0.5.4 está disponível" e decide quando atualizar.

Detalhes: o repositório de atualizações entra no instalador sozinho quando ele é gerado pelo Actions
(`GITHUB_REPOSITORY`). Num `pnpm build:win` local, preencha `DEFAULT_UPDATE_REPO` em `src/shared/config.ts`
(formato `usuario/repositorio`) antes. Sem isso, o app funciona normalmente, só não procura atualização
(Configurações mostra isso). O repositório precisa ser público.

## Se o `pnpm install` ou o build der erro

Erro "Cannot find native binding" (`rolldown`, `lightningcss`...): é o bug do `npm` com peças nativas. Use `pnpm`.
Se já usou `npm` nesta pasta, apague `node_modules` e rode `pnpm install` de novo.

Evite deixar o projeto numa pasta sincronizada pelo OneDrive (como Desktop ou Documentos): ele cria milhares de
arquivos e a sincronização atrapalha. `C:\pedro.gg` é uma boa escolha.

Erro de "symbolic link" / "privilege" no `build:win`: ative o Modo de Desenvolvedor do Windows
(Configurações > Para desenvolvedores) e rode `pnpm build:win` de novo.

## Dados de meta (winrates, confrontos, sinergias e builds)

O arquivo que vem no instalador (`resources/meta.sample.json`) é uma **amostra fictícia**; o app avisa isso na tela.
Nem o smartpick.gg nem o draftforge.gg oferecem API pública (veja `docs/pesquisa.md`), então os dados reais vêm da
**Match-v5 da Riot**:

    # Windows (PowerShell):  $env:RIOT_API_KEY = "RGAPI-..."
    pnpm meta:build --platform br1 --max-matches 3000

A chave vem de developer.riotgames.com. Chaves de desenvolvimento expiram a cada 24 h e limitam as requisições, então a
coleta é lenta (cerca de 0,8 requisição por segundo). Se for interrompida (Ctrl+C, queda de internet, chave vencida),
rode o mesmo comando de novo: ela retoma de onde parou, sem contar partidas em dobro. `pnpm meta:build --help`
lista todas as opções. O resultado inclui confrontos, **sinergias entre aliados**, builds, ordem de habilidades, **runas e feitiços** mais usados nas vitórias.
Rode o gerador de novo para o botão de importar ter runas e feitiços (os dados antigos continuam funcionando, só sem essa parte).

### Automático pelo GitHub (recomendado)

O repositório tem o workflow **Atualizar dados de meta** (`.github/workflows/update-meta.yml`). Ele roda o gerador nos
servidores do GitHub, valida o resultado (`pnpm meta:check --strict`) e publica o `meta.json` na branch `data`; o app já
vem apontando para ela (`DEFAULT_META_URL` em `src/shared/config.ts`). Configuração, uma vez só:

1. No GitHub: **Settings > Secrets and variables > Actions > New repository secret**, nome `RIOT_API_KEY`, valor a chave
   `RGAPI-...` de developer.riotgames.com (chave de desenvolvimento vale 24 h; para ficar permanente, peça uma chave
   pessoal no portal da Riot).
2. **Actions > Atualizar dados de meta > Run workflow**. Em "Servidores" escolha um ou mais (padrão `br1,euw1,kr`) e,
   em "Partidas por servidor", quantas coletar (padrão 6000) e, em "Partidas com timeline", quantas baixam a timeline
   (builds, habilidades e itens; padrão 3000, 0 = todas). Cada **cluster** da Riot (americas, europe, asia, sea)
   tem o próprio limite da chave, então servidores de clusters diferentes rodam **em paralelo** (cada um leva de 2 a
   3 horas) e servidores do mesmo cluster (ex.: `br1,na1`) rodam em sequência no mesmo job, que tem 350 min: com 7000 partidas e 5000 timelines por servidor **só cabe um**, então rode um servidor do mesmo cluster por execução ou reduza as partidas. No fim, as
   contagens de todos os servidores são **somadas num `meta.json` global** (só entram partidas do mesmo patch) e cada servidor
   também gera o seu `meta-<servidor>.json`. Se a chave
   vencer no meio, rode de novo: o progresso fica em cache. Os campos **rps** e **days** (partidas dos últimos N dias)
   também ficam no formulário; mantenha o `rps` em 0,8 (veja "Chave pessoal" abaixo).
3. Depois disso roda sozinho toda semana. Se a validação falhar (poucos campeões/partidas), nada é publicado.

#### Chave pessoal e mais partidas

A chave de desenvolvimento vale 24 h. Um projeto aprovado em developer.riotgames.com ganha uma chave que **não expira**,
então o agendamento de quarta-feira funciona sem ninguém renovar nada: troque o valor do secret `RIOT_API_KEY` (o nome
continua o mesmo). **Ela não aumenta a velocidade**: o limite padrão (20 requisições por segundo e **100 a cada 2
minutos**) é o mesmo da chave de desenvolvimento, e o que manda é o limite longo, cerca de 0,83 requisição por segundo.
Por isso o padrão do gerador é 0,8 e não adianta subir o campo **rps** (só geraria erros 429). Os limites por método
(league-v4, etc.) são maiores, mas o limite do app vale para todas as chamadas somadas.

O que realmente aumenta a quantidade de dados:
- **Mais servidores**: cada cluster da Riot tem o próprio limite, então `br1,euw1,kr` coletam em paralelo e somam. Adicionar
  `na1`, `la1` etc. multiplica as partidas sem aumentar o tempo (só o do mesmo cluster, ex. `br1` e `na1`, soma tempo).
- **Menos timelines**: cada partida custa 1 requisição e a timeline (builds) custa outra. Baixar `timeline_matches`
  libera requisições para mais partidas de winrate e confrontos.
- **Tempo do job**: ele tem 350 min e agora cada servidor para sozinho no seu tempo (`--max-minutes`), gera o arquivo com o que já coletou e o job termina bem, publicando os dados; a próxima execução continua de onde parou. Em 350 min cabem cerca de 16 mil requisições por servidor. Algo como 7000 partidas com 5000 timelines
  por servidor cabe; acima disso a coleta para no limite de tempo e continua na próxima execução (o progresso fica em cache).
- **Chave de produção**: só a Riot libera limites maiores, pedindo uma revisão do produto no portal.

Nunca cole a chave em arquivos do projeto: ela só vive no secret do GitHub.

Para chegar aos amigos sem o workflow: suba o `meta.json` para um repositório público, coloque o endereço em
`DEFAULT_META_URL` **antes** de gerar o instalador (quem já instalou cola em Configurações). O app baixa a versão nova ao
abrir, se a opção estiver ligada.

Também dá para importar um `meta.json` manualmente em Configurações > Importar dados de meta.

## Aviso do Windows (SmartScreen)

O instalador **não é assinado** (certificado de assinatura de código é pago), então o Windows pode mostrar "O Windows
protegeu o seu computador". Clique em **Mais informações > Executar assim mesmo**. O aviso diminui com o número de
downloads. Quando houver um certificado, basta configurar `CSC_LINK` e `CSC_KEY_PASSWORD` como secrets do GitHub: o
electron-builder passa a assinar sozinho no workflow de build.

## Limitações conhecidas
- O Pós-jogo e o aceite automático usam endpoints do cliente do LoL (LCU) que a Riot **não** suporta oficialmente para
  apps de terceiros e podem mudar num patch. Os caminhos usados são `/lol-matchmaking/v1/ready-check/accept`,
  `/lol-end-of-game/v1/eog-stats-block`, `/lol-match-history/v1/games/{id}`, `/lol-match-history/v1/game-timelines/{id}`
  e `/lol-gameflow/v1/gameflow-phase`. Foram testados contra um cliente simulado, **não contra o cliente real**. O app
  guarda a resposta bruta das últimas 5 partidas em `postgame/raw` (pasta de dados do app) para ajustar o leitor se o
  formato vier diferente.
- O **importar runas/itens** e a **leitura da conta/amigos** também usam endpoints não oficiais do cliente e foram testados só contra um cliente simulado.
- O **overlay** foi testado com dados simulados da Live Client Data API, não numa partida real. Ele só lê; não automatiza nada. Não aparece com o jogo em tela cheia exclusiva, e só funciona em Summoner's Rift (Normal, Ranqueada, etc.).
- Os dados de meta reais dependem de você rodar o gerador uma vez por patch (e de uma chave da Riot).
- A atualização automática foi testada com um atualizador simulado e com o app empacotado, mas ainda não contra um
  Release real do GitHub: o primeiro teste de verdade é publicar uma versão nova e ver o aviso na anterior.
- Os dados do jogo (campeões, itens) ficam salvos no PC depois da primeira execução, mas as **imagens** vêm do CDN da
  Riot. Sem internet, o app mostra a inicial de cada campeão no lugar do ícone.
- A tabela de rotas e funções é curada à mão e pode ficar atrás do patch; "Todos" sempre mostra tudo.
