// src/preload/index.ts
// Ponte segura: o renderer só enxerga estas funções, nunca o ipcRenderer inteiro,
// nem Node, nem a senha da LCU.
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../main/ipc/channels'
import type { LolApi, Unsubscribe } from '../shared/api'

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_event: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: LolApi = {
  onMetaUpdated: (cb) => subscribe(IPC.META_UPDATED, cb),
  onLcuStatus: (cb) => subscribe(IPC.LCU_STATUS, cb),
  onDraftUpdate: (cb) => subscribe(IPC.DRAFT_UPDATE, cb),
  onDraftEnded: (cb) => subscribe<void>(IPC.DRAFT_ENDED, () => cb()),
  applyLoadout: (req) => ipcRenderer.invoke(IPC.LOADOUT_APPLY, req),
  onIdentity: (cb) => subscribe(IPC.IDENTITY_UPDATE, cb),
  getIdentity: () => ipcRenderer.invoke(IPC.IDENTITY_GET),
  getAccountStats: () => ipcRenderer.invoke(IPC.ACCOUNT_STATS),
  claimProfile: (id) => ipcRenderer.invoke(IPC.IDENTITY_CLAIM, id),
  onUpdateState: (cb) => subscribe(IPC.UPDATE_STATE, cb),
  getDiagnostics: () => ipcRenderer.invoke(IPC.DIAG_REPORT),
  getLastAccept: () => ipcRenderer.invoke(IPC.DIAG_ACCEPT),
  onPostGameReady: (cb) => subscribe(IPC.POSTGAME_READY, cb),
  listPostGames: () => ipcRenderer.invoke(IPC.POSTGAME_LIST),
  getPostGame: (id) => ipcRenderer.invoke(IPC.POSTGAME_GET, id),
  deletePostGame: (id) => ipcRenderer.invoke(IPC.POSTGAME_DELETE, id),
  fetchLatestPostGame: () => ipcRenderer.invoke(IPC.POSTGAME_FETCH_LATEST),
  onAutoAccepted: (cb) => subscribe<void>(IPC.MATCH_AUTO_ACCEPTED, () => cb()),

  getLcuStatus: () => ipcRenderer.invoke(IPC.LCU_GET_STATUS),
  getCurrentDraft: () => ipcRenderer.invoke(IPC.DRAFT_GET_CURRENT),
  recommend: (req) => ipcRenderer.invoke(IPC.DRAFT_RECOMMEND, req),

  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (patch) => ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
  pickGameDir: () => ipcRenderer.invoke(IPC.SETTINGS_PICK_GAME_DIR),

  listProfiles: () => ipcRenderer.invoke(IPC.PROFILES_LIST),
  saveProfile: (profile) => ipcRenderer.invoke(IPC.PROFILES_SAVE, profile),
  deleteProfile: (id) => ipcRenderer.invoke(IPC.PROFILES_DELETE, id),

  getCatalog: () => ipcRenderer.invoke(IPC.DDRAGON_GET_CATALOG),
  getSpells: (key) => ipcRenderer.invoke(IPC.DDRAGON_GET_SPELLS, key),

  getMetaInfo: () => ipcRenderer.invoke(IPC.META_INFO),
  getMetaTiers: (role) => ipcRenderer.invoke(IPC.META_TIERS, role),
  getMetaDetail: (req) => ipcRenderer.invoke(IPC.META_DETAIL, req),
  getBuild: (req) => ipcRenderer.invoke(IPC.META_GET_BUILD, req),
  importMeta: () => ipcRenderer.invoke(IPC.META_IMPORT),
  updateMeta: () => ipcRenderer.invoke(IPC.META_UPDATE),

  encodeShare: (profile, opts) => ipcRenderer.invoke(IPC.SHARE_ENCODE, profile, opts),
  decodeShare: (text) => ipcRenderer.invoke(IPC.SHARE_DECODE, text),
  exportShareFile: (profile, opts) => ipcRenderer.invoke(IPC.SHARE_EXPORT_FILE, profile, opts),
  importShareFile: () => ipcRenderer.invoke(IPC.SHARE_IMPORT_FILE),
  copyText: (text) => ipcRenderer.invoke(IPC.CLIPBOARD_WRITE, text),
  readClipboardText: () => ipcRenderer.invoke(IPC.CLIPBOARD_READ),

  getUpdateState: () => ipcRenderer.invoke(IPC.UPDATE_GET),
  checkForUpdates: () => ipcRenderer.invoke(IPC.UPDATE_CHECK),
  downloadUpdate: () => ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD),
  installUpdate: () => ipcRenderer.invoke(IPC.UPDATE_INSTALL)
}

contextBridge.exposeInMainWorld('api', api)
