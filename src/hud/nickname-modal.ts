// ---------------------------------------------------------------------------
// Nickname modal — gates access to Online Multiplayer the first time
// ---------------------------------------------------------------------------
//
// Single-use flow:
//   game.ts calls `ensureOnlineIdentity()` before connecting. If a cached
//   identity exists, it resolves immediately. Otherwise the modal opens,
//   the player types a nickname, hits Play, we POST to the server, and
//   resolve once we have a valid OnlineIdentity (or reject on cancel).
//
// Validation mirrors the server rules (3–16 chars, [a-zA-Z0-9_-]) so the
// happy path doesn't even round-trip. Errors from the server (e.g. a
// nickname collision with a different token) surface below the input.
//
// H4 retención (2026-08-24) — dos superficies nuevas dentro del modal:
//   · Enlace discreto "¿Ya tienes nick? Recupéralo con tu código" que
//     despliega un input de código + botón. Recuperar = misma identidad
//     (playerId + nick) en este dispositivo, ver online-identity.ts.
//   · Interstitial de éxito tras un registro NUEVO o una recuperación,
//     con el enlace "Ver mi código de recuperación". Razonamiento: es el
//     único momento del flujo actual donde el jugador está mirando su
//     identidad; en reclaims rutinarios (isNew=false) el modal se cierra
//     directo como siempre — cero fricción añadida al camino habitual.
//     Los elementos se crean por JS (no en index.html) para mantener el
//     cambio contenido en esta superficie.
// ---------------------------------------------------------------------------

import {
  getCachedIdentity,
  getPreferredNickname,
  registerNickname,
  recoverIdentity,
  getOrFetchRecoveryCode,
  type OnlineIdentity,
} from '../online-identity';
import { t } from '../i18n';

const modalEl       = document.getElementById('nickname-modal')!;
const inputEl       = document.getElementById('nickname-input') as HTMLInputElement;
const errorEl       = document.getElementById('nickname-error')!;
const confirmBtn    = document.getElementById('btn-nickname-confirm') as HTMLButtonElement;
const cancelBtn     = document.getElementById('btn-nickname-cancel') as HTMLButtonElement;
// Null-safe a nivel de módulo (regresión cazada 2026-09-05): /tools.html
// no tiene el modal y este módulo se importa transitivamente desde
// game.ts — un querySelector sobre null aquí tumbaba el lab entero
// (batch runner y golden incluidos). Los usos viven en funciones que
// solo corren cuando el modal se muestra.
const cardEl        = (modalEl?.querySelector('.nickname-card') ?? null) as HTMLElement | null;
const subEl         = (modalEl?.querySelector('.nickname-sub') ?? null) as HTMLElement | null;
const buttonsEl     = (modalEl?.querySelector('.nickname-buttons') ?? null) as HTMLElement | null;

// Same regex as server/src/db.ts#validateNickname for snap-feedback.
const NICK_RE = /^[a-zA-Z0-9_\-]{3,16}$/;
const RESERVED = new Set(['admin', 'root', 'anonymous', 'null', 'undefined', 'guest']);

// ---------------------------------------------------------------------------
// DOM extra (recuperación + interstitial) — construido una vez al cargar.
// Estilos inline mínimos: reutilizamos las clases del modal donde existen
// y no añadimos CSS nuevo a index.html.
// ---------------------------------------------------------------------------

function makeLinkButton(id: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.id = id;
  Object.assign(b.style, {
    background: 'none',
    border: 'none',
    color: '#ffdc5c',
    opacity: '0.7',
    fontSize: '12px',
    textDecoration: 'underline',
    cursor: 'pointer',
    padding: '2px',
  } satisfies Partial<CSSStyleDeclaration>);
  return b;
}

// Fila de recuperación (oculta por defecto).
const recoveryRowEl = document.createElement('div');
Object.assign(recoveryRowEl.style, {
  display: 'none', flexDirection: 'column', gap: '8px', width: '100%',
} satisfies Partial<CSSStyleDeclaration>);
const recoveryHintEl = document.createElement('div');
Object.assign(recoveryHintEl.style, {
  fontSize: '12px', opacity: '0.75', textAlign: 'center',
} satisfies Partial<CSSStyleDeclaration>);
const recoveryInputEl = document.createElement('input');
recoveryInputEl.type = 'text';
recoveryInputEl.className = 'nickname-input';
recoveryInputEl.maxLength = 20;
recoveryInputEl.autocomplete = 'off';
recoveryInputEl.spellcheck = false;
recoveryInputEl.style.textTransform = 'uppercase';
const recoverBtnEl = document.createElement('button');
recoverBtnEl.type = 'button';
recoverBtnEl.className = 'nickname-btn';
recoveryRowEl.append(recoveryHintEl, recoveryInputEl, recoverBtnEl);

// Enlace discreto que despliega la fila de recuperación.
const recoverLinkEl = makeLinkButton('btn-nickname-recover-link');

// Interstitial de éxito (oculto por defecto).
const successEl = document.createElement('div');
Object.assign(successEl.style, {
  display: 'none', flexDirection: 'column', gap: '12px', width: '100%',
  alignItems: 'center',
} satisfies Partial<CSSStyleDeclaration>);
const successTitleEl = document.createElement('div');
Object.assign(successTitleEl.style, {
  fontSize: '20px', fontWeight: '800', color: '#ffdc5c', textAlign: 'center',
} satisfies Partial<CSSStyleDeclaration>);
const viewCodeLinkEl = makeLinkButton('btn-nickname-view-code');
const codeBoxEl = document.createElement('div');
Object.assign(codeBoxEl.style, {
  display: 'none',
  font: '700 22px/1.2 Consolas, Menlo, monospace',
  letterSpacing: '2px',
  background: 'rgba(255, 255, 255, 0.08)',
  border: '1px dashed rgba(255, 220, 92, 0.6)',
  borderRadius: '10px',
  padding: '10px 18px',
  userSelect: 'all',
} satisfies Partial<CSSStyleDeclaration>);
const codeHintEl = document.createElement('div');
Object.assign(codeHintEl.style, {
  display: 'none', fontSize: '12px', opacity: '0.75', textAlign: 'center',
} satisfies Partial<CSSStyleDeclaration>);
const continueBtnEl = document.createElement('button');
continueBtnEl.type = 'button';
continueBtnEl.className = 'nickname-btn';
continueBtnEl.style.width = '100%';
successEl.append(successTitleEl, viewCodeLinkEl, codeBoxEl, codeHintEl, continueBtnEl);

// Orden en la card: [título, sub, input, error, botones] + fila de
// recuperación + enlace + interstitial.
cardEl?.append(recoveryRowEl, recoverLinkEl, successEl);

function errorMessage(reasonCode: string): string {
  switch (reasonCode) {
    case 'too_short': return t('nickname-err-too-short');
    case 'too_long': return t('nickname-err-too-long');
    case 'invalid_chars': return t('nickname-err-invalid-chars');
    case 'reserved': return t('nickname-err-reserved');
    case 'nickname_taken': return t('nickname-err-taken');
    case 'nickname_required': return t('nickname-err-required');
    case 'invalid_token': return t('nickname-err-invalid-token');
    case 'rate_limited': return t('nickname-err-rate-limited');
    case 'network_error': return t('nickname-err-network');
    case 'recovery_failed': return t('nickname-err-bad-code');
    default: return t('nickname-err-generic');
  }
}

function clientSideValidation(nick: string): string | null {
  const trimmed = nick.trim();
  if (trimmed.length < 3) return 'too_short';
  if (trimmed.length > 16) return 'too_long';
  if (!NICK_RE.test(trimmed)) return 'invalid_chars';
  if (RESERVED.has(trimmed.toLowerCase())) return 'reserved';
  return null;
}

function showError(reason: string | null): void {
  errorEl.textContent = reason ? errorMessage(reason) : '';
}

function setBusy(busy: boolean): void {
  confirmBtn.disabled = busy;
  cancelBtn.disabled = busy;
  inputEl.disabled = busy;
  recoveryInputEl.disabled = busy;
  recoverBtnEl.disabled = busy;
  recoverLinkEl.disabled = busy;
  // El texto de reposo es la misma clave que el data-i18n del botón.
  confirmBtn.textContent = busy ? t('nickname-registering') : t('nickname-play');
  recoverBtnEl.textContent = busy ? t('nickname-recovering') : t('nickname-recover-btn');
}

function setRecoveryVisible(visible: boolean): void {
  recoveryRowEl.style.display = visible ? 'flex' : 'none';
}

/** Estado visual inicial del modal (vista de registro). */
function showRegisterView(): void {
  if (subEl) subEl.style.display = '';
  inputEl.style.display = '';
  errorEl.style.display = '';
  if (buttonsEl) buttonsEl.style.display = '';
  recoverLinkEl.style.display = '';
  successEl.style.display = 'none';
  codeBoxEl.style.display = 'none';
  codeHintEl.style.display = 'none';
  viewCodeLinkEl.style.display = '';
  viewCodeLinkEl.disabled = false;
  setRecoveryVisible(false);
  recoveryInputEl.value = '';
  // Textos dinámicos (idioma resuelto en runtime, elementos creados por JS).
  recoveryHintEl.textContent = t('nickname-recover-hint');
  recoveryInputEl.placeholder = t('nickname-code-placeholder');
  recoverLinkEl.textContent = t('nickname-recover-link');
  viewCodeLinkEl.textContent = t('nickname-view-code');
  codeHintEl.textContent = t('nickname-code-hint');
  continueBtnEl.textContent = t('nickname-continue');
}

/**
 * Ensure we have an online identity before starting a connection. Opens
 * the nickname modal if none is cached. Resolves with the identity on
 * success, rejects on cancel.
 *
 * Idempotent: if the cache hit happens, the modal never shows.
 */
export function ensureOnlineIdentity(): Promise<OnlineIdentity> {
  // 2026-05-01 final block — only the per-tab session identity
  // counts as "cached". A new tab always gets the modal with the
  // device-preferred nickname pre-filled (so accepting is one tap).
  const cached = getCachedIdentity();
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    // Fresh state on every open (the modal can be re-used).
    // Pre-fill with the device's preferred nickname so the user
    // can confirm their usual identity with a single Enter press.
    inputEl.value = getPreferredNickname();
    showError(null);
    setBusy(false);
    showRegisterView();
    modalEl.classList.remove('hidden');
    // Defer focus to next frame so the browser has the element laid out.
    requestAnimationFrame(() => {
      inputEl.focus();
      // If we pre-filled, select the text so a quick re-type
      // doesn't require a manual delete.
      if (inputEl.value) inputEl.select();
    });

    const close = () => {
      modalEl.classList.add('hidden');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      inputEl.removeEventListener('keydown', onKeydown);
      recoverLinkEl.removeEventListener('click', onRecoverToggle);
      recoverBtnEl.removeEventListener('click', onRecoverConfirm);
      recoveryInputEl.removeEventListener('keydown', onRecoveryKeydown);
      viewCodeLinkEl.removeEventListener('click', onViewCode);
      continueBtnEl.removeEventListener('click', onContinue);
    };

    const finishWith = (identity: OnlineIdentity) => {
      close();
      resolve(identity);
    };

    // Identidad ya confirmada mientras el interstitial de éxito está en
    // pantalla — el botón continuar la entrega al juego.
    let successIdentity: OnlineIdentity | null = null;

    /** Cambia la card al interstitial de éxito (post-registro nuevo o
     *  post-recuperación) con el enlace "ver mi código". */
    const showSuccess = (identity: OnlineIdentity, recovered: boolean) => {
      successIdentity = identity;
      showError(null);
      if (subEl) subEl.style.display = 'none';
      inputEl.style.display = 'none';
      errorEl.style.display = 'none';
      if (buttonsEl) buttonsEl.style.display = 'none';
      recoverLinkEl.style.display = 'none';
      setRecoveryVisible(false);
      successTitleEl.textContent = recovered
        ? t('nickname-success-recovered')
        : t('nickname-success-title');
      successEl.style.display = 'flex';
      requestAnimationFrame(() => continueBtnEl.focus());
    };

    const onConfirm = async () => {
      const raw = inputEl.value;
      const clientReason = clientSideValidation(raw);
      if (clientReason) {
        showError(clientReason);
        return;
      }
      setBusy(true);
      showError(null);
      try {
        const identity = await registerNickname(raw.trim());
        setBusy(false);
        // Primer registro de ese nick → única ocasión natural de
        // enseñar el código de recuperación. Reclaim de siempre →
        // cierre directo, cero fricción.
        if (identity.isNew) {
          showSuccess(identity, /*recovered*/ false);
        } else {
          finishWith(identity);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'server_error';
        showError(reason);
        setBusy(false);
        inputEl.focus();
      }
    };

    const onRecoverToggle = () => {
      const nowVisible = recoveryRowEl.style.display === 'none';
      setRecoveryVisible(nowVisible);
      if (nowVisible) recoveryInputEl.focus();
    };

    const onRecoverConfirm = async () => {
      const nick = inputEl.value.trim();
      const clientReason = clientSideValidation(nick);
      if (clientReason) {
        showError(clientReason);
        inputEl.focus();
        return;
      }
      const code = recoveryInputEl.value.trim();
      // Chequeo rápido de formato (el server normaliza igual): al menos
      // 8 símbolos alfanuméricos reales, guiones/espacios aparte.
      if (code.replace(/[^a-zA-Z0-9]/g, '').length < 8) {
        showError('recovery_failed');
        recoveryInputEl.focus();
        return;
      }
      setBusy(true);
      showError(null);
      try {
        const identity = await recoverIdentity(code, nick);
        setBusy(false);
        showSuccess(identity, /*recovered*/ true);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'server_error';
        showError(reason);
        setBusy(false);
        recoveryInputEl.focus();
      }
    };

    const onViewCode = async () => {
      viewCodeLinkEl.disabled = true;
      viewCodeLinkEl.textContent = t('nickname-code-loading');
      try {
        const code = await getOrFetchRecoveryCode();
        codeBoxEl.textContent = code;
        codeBoxEl.style.display = 'block';
        codeHintEl.style.display = 'block';
        viewCodeLinkEl.style.display = 'none';
      } catch {
        viewCodeLinkEl.disabled = false;
        viewCodeLinkEl.textContent = t('nickname-code-error');
      }
    };

    const onContinue = () => {
      if (successIdentity) finishWith(successIdentity);
    };

    const onCancel = () => {
      close();
      reject(new Error('cancelled'));
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };

    const onRecoveryKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); onRecoverConfirm(); }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    inputEl.addEventListener('keydown', onKeydown);
    recoverLinkEl.addEventListener('click', onRecoverToggle);
    recoverBtnEl.addEventListener('click', onRecoverConfirm);
    recoveryInputEl.addEventListener('keydown', onRecoveryKeydown);
    viewCodeLinkEl.addEventListener('click', onViewCode);
    continueBtnEl.addEventListener('click', onContinue);
  });
}

/**
 * Force the modal even if the cache is populated — used by the "Change
 * nickname" button if we ever add one. For now it's not wired; kept here
 * so the bridge is ready.
 */
export function openNicknameModalForReplacement(): Promise<OnlineIdentity> {
  // Reusing ensureOnlineIdentity while temporarily hiding the cache.
  // Simplest path: let the caller decide to clear cache first.
  return ensureOnlineIdentity();
}
