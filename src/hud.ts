// ---------------------------------------------------------------------------
// HUD barrel — re-exports every public symbol from src/hud/*
// ---------------------------------------------------------------------------
//
// The original monolithic file was 820+ lines and mixed six different
// UI concerns. It was split into focused submodules on 2026-04-22:
//
//   hud/dom-shared.ts       setMatchHudVisible + hudRoot
//   hud/runtime.ts          in-match HUD (top bar / lives / abilities /
//                           overlay / portal legend / gamepad toast /
//                           spectator prompt)
//   hud/title.ts            title screen + mode handlers
//   hud/character-select.ts roster grid + info pane
//   hud/end.ts              end screen + EndResult + stats block +
//                           showMatchHud helper
//   hud/waiting.ts          online waiting screen + slot roster
//
// Callers still `import {...} from './hud'` — this barrel re-exports
// the same public surface the old file had, so no downstream edits
// were needed. If you're adding a NEW HUD concern, create a new
// submodule in hud/ and re-export it here.
// ---------------------------------------------------------------------------

export {
  updateHUD,
  initAllLivesHUD, updateAllLivesHUD,
  showOverlay, hideOverlay,
  initAbilityHUD, updateAbilityHUD, setCopycatTarget,
  setPortalLegend, setPortalToggleHandler,
  showSpectatorPrompt, hideSpectatorPrompt,
  showGamepadToast,
} from './hud/runtime';

export {
  showTitleScreen, hideTitleScreen,
  setTitleModeHandlers, updateTitleModeSelection,
  isOnlineModeAvailable,
} from './hud/title';
export type { TitleMode } from './hud/title';

export {
  showCharacterSelect, updateCharacterSelect, hideCharacterSelect,
  setSlotClickHandler,
} from './hud/character-select';

export {
  showEndScreen, hideEndScreen,
  setEndTapHandler,
  showMatchHud,
  setEndMatchStats, clearEndMatchStats,
} from './hud/end';
export type { EndResult, EndMatchStats } from './hud/end';

export {
  showWaitingScreen, hideWaitingScreen, updateWaitingScreen,
} from './hud/waiting';
export type { WaitingSlotKind, WaitingSlotData, WaitingScreenData } from './hud/waiting';
