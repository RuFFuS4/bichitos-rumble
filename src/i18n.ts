// ---------------------------------------------------------------------------
// i18n — ES/EN para las superficies del JUGADOR (H4 del ROADMAP)
// ---------------------------------------------------------------------------
//
// CONTRATO DE LA CASA (leer antes de tocar nada):
//
//  · El INGLÉS es el idioma FUENTE. El markup de index.html queda en inglés
//    y el diccionario `en:` debe ser byte-a-byte lo que había en el HTML.
//    Los `es:` se rellenaron en fase 3 (2026-08-24): castellano de España,
//    tono arcade. Nombres propios (Bichitos Rumble, critters, habilidades,
//    cinturones del catálogo) NO se traducen.
//
//  · Claves kebab-case con prefijo de pantalla:
//      'title-*'     pantalla de título        'select-*'    character select
//      'waiting-*'   sala de espera online     'end-*'       end screen
//      'pause-*'     menú de pausa             'nickname-*'  modal de nickname
//      'spectator-*' aviso de espectador       'rotate-*'    prompt de rotación
//      'legal-*'     enlaces legales
//    Ejemplos: 'title-play-bots', 'end-victory'.
//
//  · Alcance: SOLO lo que ve el jugador. tools/labs (tools.html, studio,
//    src/tools/*), consola y docs quedan FUERA — siempre en inglés.
//
//  · Superficies estáticas (index.html) se marcan con atributos data-* y
//    las resuelve applyStaticI18n() al arrancar (llamada en src/main.ts):
//      data-i18n="clave"             → element.textContent = t(clave)
//      data-i18n-html="clave"        → element.innerHTML   = t(clave)
//        (para los pocos valores con markup interno: los <kbd>/<span> van
//         DENTRO del valor del diccionario. NUNCA interpolar input del
//         usuario en un valor del diccionario — innerHTML confía en él.)
//      data-i18n-placeholder="clave" → atributo placeholder (inputs)
//    Atributos title/aria: sin variante de momento — se añadirá
//    data-i18n-title si alguna fase la necesita.
//
//  · Strings dinámicos de src/ (hud.ts, end.ts, waiting.ts...): importar
//    `t()` y sustituir el literal por t('clave') — fase 2.
//
//  · Detección de idioma (en orden):
//      1. ?lang=es|en en la URL  → override; se persiste en localStorage
//      2. localStorage 'lang'    → elección previa
//      3. navigator.language     → empieza por 'es' → español
//      4. fallback               → 'en'
//    El idioma se resuelve UNA vez por carga (getLang() cachea). Cambiar
//    de idioma = recargar con ?lang=xx. Sin re-render en caliente: barato
//    y suficiente para un juego que arranca en <2 s.
// ---------------------------------------------------------------------------

export type Lang = 'en' | 'es';

interface Entry {
  en: string;
  es: string;
}

// NOTA: los `es:` que coinciden con el `en:` lo hacen a propósito (nombres
// propios o términos idénticos en ambos idiomas): 'title-play-bots',
// 'hud-bot', 'waiting-badge-bot', 'status-vulnerable', 'status-steel-shell'.
const DICT = {
  // ---- Title screen -------------------------------------------------------
  'title-tagline':          { en: 'HEADBUTT YOUR RIVALS INTO THE VOID',
                              es: '¡CABEZAZOS AL VACÍO!' },
  'title-play-bots':        { en: '🤖 vs Bots',
                              es: '🤖 vs Bots' },
  'title-play-online':      { en: '🌐 Online Multiplayer (up to 4P)',
                              es: '🌐 Multijugador online (hasta 4J)' },
  'title-play-friends':     { en: '👥 Play with Friends',
                              es: '👥 Jugar con amigos' },
  // [html] prompts con <kbd> incrustado
  'title-prompt-desktop':   { en: '<kbd>◄</kbd> <kbd>►</kbd> switch · <kbd>ENTER</kbd> confirm',
                              es: '<kbd>◄</kbd> <kbd>►</kbd> cambiar · <kbd>ENTER</kbd> confirmar' },
  'title-prompt-touch':     { en: 'Tap a mode to play',
                              es: 'Toca un modo para jugar' },
  // [html] fila de controles de teclado (spans + separadores del layout)
  'title-controls-desktop': { en: '<span><kbd>WASD</kbd> move</span> <span class="sep">·</span> <span><kbd>SPACE</kbd> headbutt</span> <span class="sep">·</span> <span><kbd>J</kbd> <kbd>K</kbd> abilities</span> <span class="sep">·</span> <span><kbd>L</kbd> ultimate</span> <span class="sep">·</span> <span><kbd>R</kbd> restart</span>',
                              es: '<span><kbd>WASD</kbd> mover</span> <span class="sep">·</span> <span><kbd>SPACE</kbd> cabezazo</span> <span class="sep">·</span> <span><kbd>J</kbd> <kbd>K</kbd> habilidades</span> <span class="sep">·</span> <span><kbd>L</kbd> definitiva</span> <span class="sep">·</span> <span><kbd>R</kbd> reiniciar</span>' },
  'title-controls-touch':   { en: 'Joystick to move · on-screen buttons for headbutt, abilities and ultimate',
                              es: 'Joystick para moverte · botones en pantalla para cabezazo, habilidades y definitiva' },
  // [html] leyenda de gamepad
  'title-controls-gamepad': { en: '🎮 Gamepad supported — left stick move · <kbd>A</kbd> headbutt · <kbd>X</kbd> <kbd>Y</kbd> abilities · <kbd>RB</kbd> ultimate · <kbd>Start</kbd> restart',
                              es: '🎮 Compatible con mando — stick izquierdo mover · <kbd>A</kbd> cabezazo · <kbd>X</kbd> <kbd>Y</kbd> habilidades · <kbd>RB</kbd> definitiva · <kbd>Start</kbd> reiniciar' },
  'legal-privacy':          { en: 'Privacy', es: 'Privacidad' },
  'legal-terms':            { en: 'Terms',   es: 'Términos' },

  // ---- Character select ---------------------------------------------------
  'select-title':           { en: 'CHOOSE YOUR BICHITO',
                              es: 'ELIGE TU BICHITO' },
  // [html]
  'select-prompt-kbd':      { en: '<kbd>◄</kbd> <kbd>►</kbd> select · <kbd>SPACE</kbd> confirm · drag to rotate · <kbd>B</kbd> belts',
                              es: '<kbd>◄</kbd> <kbd>►</kbd> elegir · <kbd>SPACE</kbd> confirmar · arrastra para girar · <kbd>B</kbd> cinturones' },
  // [html]
  'select-prompt-gamepad':  { en: '<kbd>D-Pad</kbd> select · <kbd>A</kbd> confirm · drag to rotate · <kbd>Select</kbd> belts',
                              es: '<kbd>D-Pad</kbd> elegir · <kbd>A</kbd> confirmar · arrastra para girar · <kbd>Select</kbd> cinturones' },
  'select-prompt-touch':    { en: 'Tap a slot to select · tap again to confirm · drag preview to rotate',
                              es: 'Toca una casilla para elegir · toca otra vez para confirmar · arrastra para girar' },
  'select-belts':           { en: 'Belts', es: 'Cinturones' },

  // ---- Waiting screen (online 4P) ----------------------------------------
  'waiting-title':            { en: 'WAITING FOR CRITTERS',
                                es: 'ESPERANDO BICHITOS' },
  'waiting-subtitle':         { en: 'Match begins when the room is full.',
                                es: 'La partida empieza cuando se llene la sala.' },
  'waiting-countdown-label':  { en: 'Bots join in',
                                es: 'Los bots entran en' },
  'waiting-countdown-unit':   { en: 'seconds',
                                es: 'segundos' },
  'waiting-share-label':      { en: 'Invite your friends:',
                                es: 'Invita a tus colegas:' },
  'waiting-share-copy':       { en: '📋 Copy link',
                                es: '📋 Copiar enlace' },
  'waiting-share-native':     { en: '📤 Share',
                                es: '📤 Compartir' },
  'waiting-hint':             { en: "If the room doesn't fill in time, bots will take the remaining slots.",
                                es: 'Si la sala no se llena a tiempo, los bots ocuparán los huecos libres.' },
  // [html]
  'waiting-prompt-leave':       { en: '<kbd>T</kbd> leave room',
                                  es: '<kbd>T</kbd> salir de la sala' },
  'waiting-prompt-leave-touch': { en: 'Tap T to leave',
                                  es: 'Toca T para salir' },

  // ---- Spectator prompt (eliminado en partida online) ---------------------
  'spectator-out':            { en: "You're out ·",
                                es: '¡Estás fuera! ·' },
  // [html]
  'spectator-leave-desktop':  { en: 'Press <kbd>T</kbd> to leave',
                                es: 'Pulsa <kbd>T</kbd> para salir' },
  'spectator-leave-touch':    { en: 'Tap T to leave',
                                es: 'Toca T para salir' },

  // ---- Nickname modal (identidad online) ----------------------------------
  'nickname-title':         { en: 'PICK YOUR NICKNAME',
                              es: 'ELIGE TU NICK' },
  'nickname-sub':           { en: 'Needed to compete for Online Belts (Throne, Flash, Ironclad, Slayer, Hot Streak). Stored per device — no login, no password.',
                              es: 'Necesario para competir por los Cinturones Online (Throne, Flash, Ironclad, Slayer, Hot Streak). Se guarda en tu dispositivo — sin cuentas ni contraseñas.' },
  // [placeholder] del input de nickname
  'nickname-placeholder':   { en: '3–16 chars · letters/digits/-/_',
                              es: '3–16 caracteres · letras/números/-/_' },
  'nickname-play':          { en: '▶ Play online',
                              es: '▶ Jugar online' },
  'nickname-cancel':        { en: 'Cancel',
                              es: 'Cancelar' },

  // ---- Pause menu (offline) -----------------------------------------------
  'pause-title':            { en: 'PAUSED',           es: 'PAUSA' },
  'pause-resume':           { en: '▶ Resume',         es: '▶ Continuar' },
  'pause-restart':          { en: '↻ Restart match',  es: '↻ Reiniciar partida' },
  'pause-quit':             { en: '⏏ Quit to title',  es: '⏏ Salir al título' },
  // [html]
  'pause-prompt-resume':    { en: '<kbd>ESC</kbd> resume',
                              es: '<kbd>ESC</kbd> continuar' },

  // ---- End screen ---------------------------------------------------------
  'end-belt-earned':        { en: 'Belt earned',
                              es: 'Cinturón conseguido' },
  'end-share':              { en: '📤 Share',
                              es: '📤 Compartir' },
  // [html]
  'end-prompt-desktop':     { en: '<kbd>R</kbd> restart · <kbd>T</kbd> title',
                              es: '<kbd>R</kbd> reiniciar · <kbd>T</kbd> título' },
  'end-prompt-touch':       { en: 'Tap to play again',
                              es: 'Toca para jugar otra vez' },
  // [html]
  'end-portal-prompt':      { en: '<kbd class="kbd-portal-exit">P</kbd> next game 🌀 · <kbd class="kbd-portal-return">B</kbd> return to previous',
                              es: '<kbd class="kbd-portal-exit">P</kbd> siguiente juego 🌀 · <kbd class="kbd-portal-return">B</kbd> volver al anterior' },

  // ---- Rotate prompt (móvil en portrait) ----------------------------------
  'rotate-text':            { en: 'Please rotate your device',
                              es: 'Gira el dispositivo' },
  'rotate-sub':             { en: 'Bichitos Rumble is designed for landscape',
                              es: 'Bichitos Rumble está pensado para jugar en horizontal' },

  // =========================================================================
  // FASE 2 — strings dinámicos (t()/tf() desde src/). Los valores con {var}
  // se interpolan con tf(); el nombre del placeholder forma parte del
  // contrato de la clave (misma variable en en: y es:).
  // =========================================================================

  // ---- Connect (alerts de src/game.ts al conectar online) -----------------
  'connect-nickname-active':  { en: 'This nickname is already active in another tab on this device.\n\nUse a different nickname or close the other tab and try again.',
                                es: 'Ese nick ya está activo en otra pestaña de este dispositivo.\n\nUsa otro nick o cierra la otra pestaña y vuelve a intentarlo.' },
  'connect-nickname-taken':   { en: 'This nickname is already in use by another device.\n\nPick a different nickname.',
                                es: 'Ese nick ya está en uso en otro dispositivo.\n\nElige otro.' },
  'connect-failed':           { en: 'Could not connect to multiplayer server.\n\nIn dev: make sure the server is running (cd server && npm run dev).\nIn prod: contact the site owner.',
                                es: 'No se ha podido conectar con el servidor multijugador.\n\nEn dev: asegúrate de que el servidor está en marcha (cd server && npm run dev).\nEn prod: contacta con el dueño del sitio.' },
  'connect-failed-server-said': { en: 'Server said: {msg}',
                                  es: 'El servidor dice: {msg}' },

  // ---- HUD in-match (overlay central, top bar, ability bar, toasts) -------
  'hud-connecting':           { en: 'Connecting...',            es: 'Conectando...' },
  'hud-preparing-arena':      { en: 'Preparing arena…',         es: 'Preparando la arena…' },
  'hud-get-ready':            { en: 'Get Ready!',               es: '¡Prepárate!' },
  'hud-waiting-opponent':     { en: 'Waiting for opponent...',  es: 'Esperando rival...' },
  'hud-reconnecting':         { en: 'Reconnecting…',            es: 'Reconectando…' },
  'hud-reconnecting-sub':     { en: 'Connection lost — a bot covers you meanwhile', es: 'Conexión perdida — un bot te cubre mientras tanto' },
  'hud-disconnected':         { en: 'Disconnected',             es: 'Desconectado' },
  'hud-disconnected-sub':     { en: 'Press T to return to title',
                                es: 'Pulsa T para volver al título' },
  'hud-leaving':              { en: 'Leaving...',               es: 'Saliendo...' },
  // OJO: hud/runtime.ts#digitVariant compara el texto del overlay con este
  // valor para aplicar el estilo verde de "GO!". Si cambias el es:, el
  // matching sigue funcionando (compara contra t('hud-go')).
  'hud-go':                   { en: 'GO!',                      es: '¡YA!' },
  'hud-alive':                { en: 'Alive: {n}',               es: 'Vivos: {n}' },
  'hud-bot':                  { en: 'Bot',                      es: 'Bot' },
  'hud-soon':                 { en: 'SOON',                     es: 'PRONTO' },
  'hud-copycat-target':       { en: 'Copycat target: {name}',   es: 'Objetivo del Copycat: {name}' },
  'hud-gamepad-disconnected': { en: '🎮 Gamepad disconnected',  es: '🎮 Mando desconectado' },
  'hud-sfx-enable':           { en: 'Enable sound effects',     es: 'Activar efectos de sonido' },
  'hud-sfx-disable':          { en: 'Disable sound effects',    es: 'Desactivar efectos de sonido' },
  'hud-music-enable':         { en: 'Enable music',             es: 'Activar música' },
  'hud-music-disable':        { en: 'Disable music',            es: 'Desactivar música' },
  // Leyenda de portales (estática en hud.partial.html, via data-i18n)
  'hud-portal-multiverse':    { en: 'Vibe Jam Games Multiverse',
                                es: 'Multiverso de juegos Vibe Jam' },
  'hud-portal-return':        { en: 'Return to previous world',
                                es: 'Volver al mundo anterior' },
  // [html]
  'hud-portal-hint':          { en: 'Press <kbd>P</kbd> to show',
                                es: 'Pulsa <kbd>P</kbd> para mostrar' },

  // ---- Status legend (popup "?" del HUD) ----------------------------------
  'status-title':             { en: 'Status effects',           es: 'Efectos de estado' },
  'status-frozen':            { en: 'Frozen',                   es: 'Congelado' },
  'status-frozen-desc':       { en: 'Hit by snowball — slowed and chilled.',
                                es: 'Bola de nieve al canto — más lento y tiritando.' },
  'status-slowed':            { en: 'Slowed',                   es: 'Ralentizado' },
  'status-slowed-desc':       { en: 'Movement reduced (e.g. quicksand).',
                                es: 'Movimiento reducido (p. ej. arenas movedizas).' },
  'status-poisoned':          { en: 'Poisoned',                 es: 'Envenenado' },
  'status-poisoned-desc':     { en: 'Toxic cloud — slowed + limited vision.',
                                es: 'Nube tóxica — más lento y con visión limitada.' },
  'status-stunned':           { en: 'Stunned',                  es: 'Aturdido' },
  'status-stunned-desc':      { en: 'Cannot move for a brief window.',
                                es: 'No puede moverse durante un instante.' },
  'status-vulnerable':        { en: 'Vulnerable',               es: 'Vulnerable' },
  'status-vulnerable-desc':   { en: 'Hits land twice as hard.',
                                es: 'Los golpes duelen el doble.' },
  // 'Steel Shell' es nombre propio de habilidad — no se traduce.
  'status-steel-shell':       { en: 'Steel Shell',              es: 'Steel Shell' },
  'status-steel-shell-desc':  { en: 'Invulnerable and anchored to the ground.',
                                es: 'Invulnerable y anclado al suelo.' },
  'status-frenzy':            { en: 'Frenzy',                   es: 'Frenesí' },
  'status-frenzy-desc':       { en: 'Temporarily faster and heavier.',
                                es: 'Más rápido y más pesado durante un rato.' },
  'status-ghost':             { en: 'Ghost',                    es: 'Fantasma' },
  'status-ghost-desc':        { en: 'Decoy / invisibility trick — bots lose track.',
                                es: 'Truco de señuelo/invisibilidad — los bots te pierden de vista.' },

  // ---- End screen (títulos/subtítulos dinámicos de game.ts) ---------------
  'end-title-victory':        { en: 'VICTORY',                  es: '¡VICTORIA!' },
  'end-title-defeated':       { en: 'DEFEATED',                 es: 'DERROTA' },
  'end-title-draw':           { en: 'DRAW',                     es: 'EMPATE' },
  'end-title-eliminated':     { en: 'ELIMINATED',               es: 'ELIMINADO' },
  'end-title-survived':       { en: 'SURVIVED',                 es: 'SUPERVIVIENTE' },
  'end-title-time-up':        { en: 'TIME UP',                  es: '¡TIEMPO!' },
  'end-sub-you-won':          { en: 'You won',                  es: '¡Has ganado!' },
  'end-sub-no-winner':        { en: 'No winner',                es: 'Sin ganador' },
  'end-sub-won-by-default':   { en: 'You won by default',       es: 'Ganas por incomparecencia' },
  'end-sub-bot-won':          { en: 'Bot {name} won',           es: 'Ha ganado el bot {name}' },
  'end-sub-player-won':       { en: '{name} won',               es: 'Ha ganado {name}' },
  // Fallback de {name} en end-sub-player-won — minúscula: va en mitad de frase.
  'end-opponent':             { en: 'Opponent',                 es: 'tu rival' },
  'end-sub-fell-void':        { en: '{name} fell into the void',
                                es: '{name} se ha caído al vacío' },
  'end-sub-last-standing':    { en: '{name} is the last one standing',
                                es: '{name} es el último bicho en pie' },
  'end-sub-made-it':          { en: '{name} made it to the end',
                                es: '{name} ha aguantado hasta el final' },
  'end-sub-better-luck':      { en: 'Better luck next time',    es: 'Más suerte la próxima' },
  'end-stat-headbutts':       { en: 'Headbutts',                es: 'Cabezazos' },
  'end-stat-abilities':       { en: 'Abilities',                es: 'Habilidades' },
  'end-stat-falls':           { en: 'Falls',                    es: 'Caídas' },
  'end-stat-respawns':        { en: 'Respawns',                 es: 'Reapariciones' },

  // ---- Share (end screen + waiting room) ----------------------------------
  'share-pitch':              { en: 'Bichitos Rumble — free web arena brawler!',
                                es: 'Bichitos Rumble — ¡mamporros gratis en tu navegador!' },
  'share-playing':            { en: 'Playing Bichitos Rumble — free web arena brawler! 🐛',
                                es: 'Jugando a Bichitos Rumble — ¡mamporros gratis en tu navegador! 🐛' },
  'share-won-online':         { en: 'I just won an online brawl in Bichitos Rumble! 🐛👊',
                                es: '¡Acabo de ganar una pelea online en Bichitos Rumble! 🐛👊' },
  'share-won-as':             { en: 'I just won as {name} in Bichitos Rumble! 🐛👊',
                                es: '¡Acabo de ganar con {name} en Bichitos Rumble! 🐛👊' },
  'share-copied':             { en: '✅ Copied!',                es: '✅ ¡Copiado!' },
  'share-join-room':          { en: 'Join my private room in Bichitos Rumble!',
                                es: '¡Únete a mi sala privada en Bichitos Rumble!' },

  // ---- Waiting screen (slots dinámicos) -----------------------------------
  'waiting-slot-open':        { en: 'Open',                     es: 'Libre' },
  'waiting-badge-human':      { en: 'HUMAN',                    es: 'HUMANO' },
  'waiting-badge-bot':        { en: 'BOT',                      es: 'BOT' },
  'waiting-badge-open':       { en: 'OPEN',                     es: 'LIBRE' },

  // ---- Nickname modal (errores + estado busy) -----------------------------
  'nickname-err-too-short':     { en: 'Nickname must be at least 3 characters.',
                                  es: 'El nick debe tener al menos 3 caracteres.' },
  'nickname-err-too-long':      { en: 'Nickname must be at most 16 characters.',
                                  es: 'El nick puede tener 16 caracteres como mucho.' },
  'nickname-err-invalid-chars': { en: 'Only letters, digits, "-" and "_" allowed.',
                                  es: 'Solo letras, números, "-" y "_".' },
  'nickname-err-reserved':      { en: 'That nickname is reserved. Pick another.',
                                  es: 'Ese nick está reservado. Elige otro.' },
  'nickname-err-taken':         { en: 'That nickname is already taken. Pick another.',
                                  es: 'Ese nick ya está pillado. Elige otro.' },
  'nickname-err-required':      { en: 'Nickname is required.',
                                  es: 'Te falta el nick.' },
  'nickname-err-invalid-token': { en: 'Session invalid. Refresh the page.',
                                  es: 'Sesión no válida. Recarga la página.' },
  'nickname-err-rate-limited':  { en: 'Too many attempts — wait a moment.',
                                  es: 'Demasiados intentos — espera un momento.' },
  'nickname-err-network':       { en: 'Could not reach the server. Check your connection.',
                                  es: 'No hay conexión con el servidor. Revisa tu red.' },
  'nickname-err-generic':       { en: 'Something went wrong. Try again.',
                                  es: 'Algo ha salido mal. Inténtalo otra vez.' },
  'nickname-registering':       { en: 'Registering…',           es: 'Registrando…' },

  // ---- Nickname modal (recuperación cross-device, H4) ---------------------
  'nickname-recover-link':      { en: 'Already have a nick? Recover it with your code',
                                  es: '¿Ya tienes nick? Recupéralo con tu código' },
  'nickname-recover-hint':      { en: 'Type your nick above and your recovery code here:',
                                  es: 'Pon tu nick arriba y tu código de recuperación aquí:' },
  // Formato de código, no texto — idéntico en ambos idiomas a propósito.
  'nickname-code-placeholder':  { en: 'BICHO-XXXX-XXXX',        es: 'BICHO-XXXX-XXXX' },
  'nickname-recover-btn':       { en: '🔑 Recover',              es: '🔑 Recuperar' },
  'nickname-recovering':        { en: 'Recovering…',            es: 'Recuperando…' },
  'nickname-err-bad-code':      { en: 'Wrong nick or code. Check both.',
                                  es: 'Nick o código incorrectos. Revisa los dos.' },
  'nickname-success-title':     { en: '✅ Nick saved!',          es: '✅ ¡Nick guardado!' },
  'nickname-success-recovered': { en: '✅ Identity recovered!',  es: '✅ ¡Identidad recuperada!' },
  'nickname-continue':          { en: '▶ Brawl on!',             es: '▶ ¡A pelear!' },
  'nickname-view-code':         { en: '🔑 View my recovery code',
                                  es: '🔑 Ver mi código de recuperación' },
  'nickname-code-hint':         { en: 'Write it down! It recovers your nick on any device.',
                                  es: '¡Apúntalo! Recupera tu nick en cualquier dispositivo.' },
  'nickname-code-loading':      { en: 'Getting your code…',     es: 'Generando tu código…' },
  'nickname-code-error':        { en: 'Could not get the code. Try again later.',
                                  es: 'No se ha podido obtener el código. Inténtalo más tarde.' },

  // ---- Character select (badges dinámicos del grid) -----------------------
  'select-wip':               { en: 'WIP',                      es: 'EN OBRAS' },
  'select-coming-soon':       { en: 'Coming Soon',              es: 'Muy pronto' },
  'select-planned':           { en: '(planned)',                es: '(en el horno)' },
} as const satisfies Record<string, Entry>;

/** Toda clave válida del diccionario — typo en t('...') = error de compilación. */
export type I18nKey = keyof typeof DICT;

const LANG_STORAGE_KEY = 'lang';

let activeLang: Lang | null = null;

function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'es';
}

/** Detección una sola vez por carga — ver contrato en la cabecera. */
function detectLang(): Lang {
  // 1. Override por URL (?lang=es|en) — persiste la elección.
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (isLang(fromUrl)) {
    try { localStorage.setItem(LANG_STORAGE_KEY, fromUrl); } catch { /* modo privado */ }
    return fromUrl;
  }
  // 2. Elección persistida.
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch { /* modo privado */ }
  // 3. Idioma del navegador.
  if (navigator.language?.toLowerCase().startsWith('es')) return 'es';
  // 4. Fallback: idioma fuente.
  return 'en';
}

/** Idioma activo de esta carga (cacheado en la primera llamada). */
export function getLang(): Lang {
  if (activeLang === null) activeLang = detectLang();
  return activeLang;
}

/** Traduce una clave al idioma activo. */
export function t(key: I18nKey): string {
  return DICT[key][getLang()];
}

/**
 * t() con interpolación: sustituye cada `{var}` del valor por `vars.var`.
 * Un placeholder sin valor en `vars` se deja tal cual (visible en QA,
 * nunca rompe). Los nombres de placeholder forman parte del contrato de
 * la clave: la fase 3 debe conservar el mismo `{var}` en el `es:`.
 */
export function tf(key: I18nKey, vars: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match);
}

/**
 * Resuelve todos los atributos data-i18n / data-i18n-html /
 * data-i18n-placeholder del documento contra el diccionario. Llamar UNA
 * vez al arrancar (src/main.ts), antes de que se muestre el título.
 * Claves desconocidas (typo en el HTML) avisan por consola y dejan el
 * texto fuente inglés intacto — nunca rompen el arranque.
 */
export function applyStaticI18n(root: ParentNode = document): void {
  const lookup = (raw: string | null, el: Element): string | null => {
    if (raw !== null && raw in DICT) return DICT[raw as I18nKey][getLang()];
    console.warn(`[i18n] unknown key "${raw}" on`, el);
    return null;
  };
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const v = lookup(el.getAttribute('data-i18n'), el);
    if (v !== null) el.textContent = v;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-html]')) {
    const v = lookup(el.getAttribute('data-i18n-html'), el);
    // Los valores vienen SOLO del diccionario tipado de arriba (markup
    // propio, sin input de usuario) — ver contrato en la cabecera.
    if (v !== null) el.innerHTML = v;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    const v = lookup(el.getAttribute('data-i18n-placeholder'), el);
    if (v !== null) el.setAttribute('placeholder', v);
  }
}
