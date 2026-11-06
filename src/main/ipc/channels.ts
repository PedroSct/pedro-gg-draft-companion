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
  ACCOUNT_STATS: 'identity:stats',
  // Main → Renderer (push): conta detectada / amigo reconhecido
  IDENTITY_UPDATE: 'identity:update',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_PICK_GAME_DIR: 'settings:pickGameDir',

  PROFILES_LIST: 'profiles:list',
  PROFILES_SAVE: 'profiles:save',
  BACKUP_EXPORT: 'backup:export',
  BACKUP_IMPORT: 'backup:import',
  PROFILES_DELETE: 'profiles:delete',

  DDRAGON_GET_CATALOG: 'ddragon:getCatalog',
  DDRAGON_GET_SPELLS: 'ddragon:getSpells',

  META_INFO: 'meta:info',
  META_PATCH_CHANGES: 'meta:patch-changes',
  META_PATCH_ACK: 'meta:patch-ack',
  META_GET_BUILD: 'meta:getBuild',
  META_BUILD_SITUATION: 'meta:buildSituation',
  DRAFT_BANS: 'draft:bans',
  DRAFT_COUNTERS: 'draft:counters',
  POOL_FROM_ACCOUNT: 'pool:from-account',
  META_TIERS: 'meta:tiers',
  META_DETAIL: 'meta:detail',
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

  OVERLAY_GET: 'overlay:get',
  OVERLAY_PREVIEW: 'overlay:preview',
  OVERLAY_MOVE_START: 'overlay:move-start',
  OVERLAY_MOVE_DONE: 'overlay:move-done',
  DIAG_REPORT: 'diag:report',
  DIAG_ACCEPT: 'diag:accept',
  DIAG_SAVE: 'diag:save',
  DIAG_PROBE: 'diag:probe',
  POSTGAME_LIST: 'postgame:list',
  POSTGAME_GET: 'postgame:get',
  POSTGAME_DELETE: 'postgame:delete',
  POSTGAME_FETCH_LATEST: 'postgame:fetchLatest',
  // Main → Renderer (push): uma partida nova foi analisada
  POSTGAME_READY: 'postgame:ready',

  // Main → janela do overlay (push): novo estado do painel
  OVERLAY_STATE: 'overlay:state',
  // Main → Renderer (push): o meta foi atualizado em segundo plano
  META_UPDATED: 'meta:updated',
  // Main → Renderer (push): mudou o estado da atualização do app
  UPDATE_STATE: 'update:state',
  // Main → Renderer (push): o app aceitou uma partida sozinho
  MATCH_AUTO_ACCEPTED: 'match:autoAccepted'
} as const
