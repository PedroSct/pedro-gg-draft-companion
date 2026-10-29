# Pesquisa: smartpick.gg, draftforge.gg e fontes de dados

Consultado em 28/10/2026. Nenhum dos dois sites publica uma API; os dados deles não podem ser consumidos pelo app.

## smartpick.gg ("Daisy")
- Roda no navegador, sem instalar nada; lê a seleção de campeões ao vivo (autossync) e recomenda picks olhando
  **composição aliada, picks inimigos, sinergias, counters e meta do patch**.
- Controles vistos: indicador *Non-meta ↔ Meta*, elo, **Champion Pool**, **Banned**, três sugestões ranqueadas (1ª, 2ª, 3ª).
- Runas e itens aparecem como "em breve". Não documentam fórmula, pesos nem fonte de dados.
- **Levado ao app**: sinergia com aliados + confronto com inimigos no score; controle de prioridade
  *Equilibrado / Conforto / Meta* (análogo ao slider Non-meta ↔ Meta).

## draftforge.gg
- Draft Coach com tabuleiro azul x vermelho (bans 1–5, picks por rota), seletor de pool (*Custom Pool*, pool por rota,
  *All Champions*), modo "Recommended", Tournament Mode, Histórico e **app de desktop que sincroniza picks/bans pelo cliente**.
- Recomendações priorizam a **pool de conforto**; motor de matchups com suavização bayesiana; matriz de sinergia de duplas;
  distintivo de **RISCO** quando counters ainda estão abertos; simulador tático e "Game Plan" do Coach.
- **Levado ao app**: pool primeiro (já era); suavização bayesiana (já era); **risco de counter** (counters que o inimigo
  ainda pode pegar, com winrate do seu campeão contra eles); **composição** de cada time (dano físico/mágico, frontline)
  com avisos; compartilhamento de Pool. Fica para depois: simulador tático de 8 atributos, Game Plan, histórico.

## Fontes de dados utilizáveis
| Dado | Fonte | Observação |
|---|---|---|
| Campeões, itens, habilidades, ícones, classes, notas de ataque/defesa/magia | Riot **Data Dragon** | Público, sem chave. Já usado. |
| Winrate, confrontos, sinergias, builds, ordem de habilidades | **Match-v5** (+ timeline) da Riot | Chave pessoal: 20 req/s e 100 req/2 min. Serve para o grupo de amigos; produto público exige *Production Key* aprovada. Já usado em `pnpm meta:build`. |
| Rota típica de cada campeão | Não existe na API da Riot (só `teamPosition` por partida, que o gerador já agrega) | Tabela curada em `src/shared/championMeta.ts`. Alternativas: Meraki Analytics `champions.json` e playrate por posição. |
| Counters e sinergias "prontos" | Sites de terceiros (u.gg, op.gg, lolalytics...) | Sem API oficial; raspar viola os termos de uso. Não usado. |

## Políticas da Riot que importam aqui
- O app só **lê** a LCU local e não automatiza nada no jogo.
- Chave de desenvolvimento expira em 24 h; chave pessoal não pode ser usada em produto público (beta aberto incluído).
- Produto público de estatísticas precisa registrar o projeto e ser aprovado (Production Key).
