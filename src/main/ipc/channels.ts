// src/main/ipc/channels.ts  (substitui a versão do Módulo 2)
// Fonte única dos nomes de canais IPC (Main e Preload importam daqui).

export const IPC = {
  // Main → Renderer (push)
  LCU_STATUS: 'lcu:status',
  DRAFT_UPDATE: 'draft:update',
  DRAFT_ENDED: 'draft:ended',

  // Renderer → Main (invoke)
  LCU_GET_STATUS: 'lcu:getStatus',
  DRAFT_GET_CURRENT: 'draft:getCurrent',
  DRAFT_RECOMMEND: 'draft:recommend',
  LOADOUT_APPLY: 'loadout:apply',
  IDENTITY_GET: 'identity:get',
  IDENTITY_CLAIM: 'identity:claim',
  // Main → Renderer (push): conta detectada / amigo reconhecido
  IDENTITY_UPDATE: 'identity:update',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_PICK_GAME_DIR: 'settings:pickGameDir',

  PROFILES_LIST: 'profiles:list',
  PROFILES_SAVE: 'profiles:save',
  PROFILES_DELETE: 'profiles:delete',

  DDRAGON_GET_CATALOG: 'ddragon:getCatalog',
  DDRAGON_GET_SPELLS: 'ddragon:getSpells',

  META_INFO: 'meta:info',
  META_GET_BUILD: 'meta:getBuild',
  META_IMPORT: 'meta:import',
  META_UPDATE: 'meta:update',

  SHARE_ENCODE: 'share:encode',
  SHARE_DECODE: 'share:decode',
  SHARE_EXPORT_FILE: 'share:exportFile',
  SHARE_IMPORT_FILE: 'share:importFile',
  CLIPBOARD_WRITE: 'clipboard:write',
  CLIPBOARD_READ: 'clipboard:read',

  UPDATE_GET: 'update:get',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',

  DIAG_REPORT: 'diag:report',
  DIAG_ACCEPT: 'diag:accept',
  POSTGAME_LIST: 'postgame:list',
  POSTGAME_GET: 'postgame:get',
  POSTGAME_DELETE: 'postgame:delete',
  POSTGAME_FETCH_LATEST: 'postgame:fetchLatest',
  // Main → Renderer (push): uma partida nova foi analisada
  POSTGAME_READY: 'postgame:ready',

  // Main → Renderer (push): o meta foi atualizado em segundo plano
  META_UPDATED: 'meta:updated',
  // Main → Renderer (push): mudou o estado da atualização do app
  UPDATE_STATE: 'update:state',
  // Main → Renderer (push): o app aceitou uma partida sozinho
  MATCH_AUTO_ACCEPTED: 'match:autoAccepted'
} as const
