// src/shared/config.ts
// Configuração de build. Preencha ANTES de gerar o instalador.

/**
 * Endereço (https) do meta.json que os apps instalados baixam sozinhos.
 * Ex.: 'https://raw.githubusercontent.com/SEU-USUARIO/pedro-gg-meta/main/meta.json'
 *
 * Vazio = o app só usa o dataset de amostra até o usuário importar um arquivo
 * ou informar um endereço em Configurações. O usuário pode trocar o endereço lá.
 */
export const DEFAULT_META_URL = ''

/**
 * Repositório do GitHub que publica as versões novas do app, no formato "dono/repositório"
 * (ex.: 'pedro/pedro-gg-draft-companion'). Vazio = o app não procura atualizações.
 *
 * Não precisa preencher se o instalador for gerado pelo GitHub Actions deste projeto: o workflow
 * já informa o repositório sozinho (variável GITHUB_REPOSITORY) na hora de gerar o instalador.
 */
export const DEFAULT_UPDATE_REPO = ''
