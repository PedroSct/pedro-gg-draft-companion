// src/shared/config.ts
// Configuração de build. Preencha ANTES de gerar o instalador.

/**
 * Endereço (https) do meta.json que os apps instalados baixam sozinhos.
 * O workflow "Atualizar dados de meta" publica o arquivo na branch `data` deste repositório.
 *
 * Vazio = o app só usa o dataset de amostra até o usuário importar um arquivo
 * ou informar um endereço em Configurações. O usuário pode trocar o endereço lá.
 */
export const DEFAULT_META_URL = 'https://raw.githubusercontent.com/PedroSct/pedro-gg-draft-companion/data/meta.json'

/**
 * Repositório do GitHub que publica as versões novas do app, no formato "dono/repositório"
 * (ex.: 'pedro/pedro-gg-draft-companion'). Vazio = o app não procura atualizações.
 *
 * Não precisa preencher se o instalador for gerado pelo GitHub Actions deste projeto: o workflow
 * já informa o repositório sozinho (variável GITHUB_REPOSITORY) na hora de gerar o instalador.
 */
export const DEFAULT_UPDATE_REPO = 'PedroSct/pedro-gg-draft-companion'

/**
 * Endereço do arquivo de uma região. O workflow publica `meta.json` (global) e `meta-<região>.json`
 * lado a lado; só endereços que terminam em `/meta.json` são trocados (endereços próprios ficam como estão).
 */
export function regionUrl(url: string, region: string): string {
  if (region === 'global' || !/^[a-z0-9]{2,8}$/.test(region)) return url
  return url.replace(/\/meta\.json(?=$|[?#])/, `/meta-${region}.json`)
}
