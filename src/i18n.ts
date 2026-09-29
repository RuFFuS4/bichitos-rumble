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
  // Botón táctil (data-menu-action="back"): en el móvil no hay T que tocar.
  'waiting-leave-btn':          { en: '⏏ Leave room',
                                  es: '⏏ Salir de la sala' },

  // ---- Spectator prompt (eliminado en partida online) ---------------------
  'spectator-out':            { en: "You're out ·",
                                es: '¡Estás fuera! ·' },
  // [html]
  'spectator-leave-desktop':  { en: 'Press <kbd>T</kbd> to leave',
                                es: 'Pulsa <kbd>T</kbd> para salir' },
  // Botón táctil, como el de la sala de espera.
  'spectator-leave-btn':      { en: 'Leave',
                                es: 'Salir' },

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

  // ---- Connect (avisos de src/game.ts al conectar online; hud/notice.ts) ---
  'connect-nickname-active':  { en: 'This nickname is already active in another tab on this device.\n\nUse a different nickname or close the other tab and try again.',
                                es: 'Ese nick ya está activo en otra pestaña de este dispositivo.\n\nUsa otro nick o cierra la otra pestaña y vuelve a intentarlo.' },
  'connect-nickname-taken':   { en: 'This nickname is already in use by another device.\n\nPick a different nickname.',
                                es: 'Ese nick ya está en uso en otro dispositivo.\n\nElige otro.' },
  'connect-identity-stale':   { en: 'Your online identity was used on another device, so this one has been signed out.\n\nTap Online again and use "Recover it with your code" to bring your nickname back here.',
                                es: 'Tu identidad online se ha usado en otro dispositivo, así que este ha quedado desconectado.\n\nVuelve a pulsar Online y usa "Recupéralo con tu código" para traer tu nick aquí.' },
  'connect-room-started':     { en: 'That room has already started.\n\nAsk your friend for a new link, or play a quick match.',
                                es: 'Esa sala ya ha empezado.\n\nPídele a tu amigo un enlace nuevo o juega una partida rápida.' },
  'connect-failed':           { en: 'Could not connect to multiplayer server.\n\nIn dev: make sure the server is running (cd server && npm run dev).\nIn prod: contact the site owner.',
                                es: 'No se ha podido conectar con el servidor multijugador.\n\nEn dev: asegúrate de que el servidor está en marcha (cd server && npm run dev).\nEn prod: contacta con el dueño del sitio.' },
  'connect-failed-server-said': { en: 'Server said: {msg}',
                                  es: 'El servidor dice: {msg}' },
  // Guard de versión cliente↔servidor (DISTRIBUCIÓN, 2026-09-21, con permiso de Rafa)
  'connect-client-outdated':  { en: 'There is a new version of Bichitos Rumble.\n\nReload the page to play online?',
                                es: 'Hay una versión nueva de Bichitos Rumble.\n\n¿Recargar la página para jugar online?' },
  'connect-server-outdated':  { en: 'The server is updating right now.\n\nTry again in a minute.',
                                es: 'El servidor se está actualizando ahora mismo.\n\nPrueba otra vez en un minuto.' },
  // Botones del aviso propio (src/hud/notice.ts) que sustituye a alert()/confirm().
  'notice-ok':                { en: 'OK',                        es: 'Vale' },
  'connect-reload':           { en: '↻ Reload',                  es: '↻ Recargar' },
  'connect-not-now':          { en: 'Not now',                   es: 'Ahora no' },

  // ---- HUD in-match (overlay central, top bar, ability bar, toasts) -------
  'hud-connecting':           { en: 'Connecting...',            es: 'Conectando...' },
  'hud-preparing-arena':      { en: 'Preparing arena…',         es: 'Preparando la arena…' },
  'hud-get-ready':            { en: 'Get Ready!',               es: '¡Prepárate!' },
  'hud-waiting-opponent':     { en: 'Waiting for opponent...',  es: 'Esperando rival...' },
  'hud-reconnecting':         { en: 'Reconnecting…',            es: 'Reconectando…' },
  'hud-reconnecting-sub':     { en: 'Connection lost — a bot covers you meanwhile', es: 'Conexión perdida — un bot te cubre mientras tanto' },
  'hud-disconnected':         { en: 'Disconnected',             es: 'Desconectado' },
  'hud-disconnected-sub':     { en: 'The connection to the server was lost.',
                                es: 'Se ha perdido la conexión con el servidor.' },
  // Cierre con código 4001 (SERVER_SHUTDOWN): el servidor se reinicia o entra en mantenimiento.
  'hud-disconnected-sub-shutdown': { en: 'The server closed the room to update or for maintenance.',
                                     es: 'El servidor ha cerrado la sala para actualizarse o por mantenimiento.' },
  // Botón del overlay de Reconectando / Desconectado (la salida en táctil).
  'hud-back-to-title':        { en: '⏏ Back to title',          es: '⏏ Volver al título' },
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
  // Covers both setters (frame-ticks.ts): Kowalski's Snowball (slowTimer)
  // and standing on his Frozen Floor (ice zone).
  'status-frozen-desc':       { en: 'Snowball or ice floor — slowed or sliding.',
                                es: 'Bola de nieve o suelo helado — más lento o patinando.' },
  'status-slowed':            { en: 'Slowed',                   es: 'Ralentizado' },
  'status-slowed-desc':       { en: 'Movement reduced (e.g. quicksand).',
                                es: 'Movimiento reducido (p. ej. arenas movedizas).' },
  'status-poisoned':          { en: 'Poisoned',                 es: 'Envenenado' },
  'status-poisoned-desc':     { en: 'Toxic cloud — slowed + limited vision.',
                                es: 'Nube tóxica — más lento y con visión limitada.' },
  'status-stunned':           { en: 'Stunned',                  es: 'Aturdido' },
  // Since 2026-09-24 (PERSONAJES) a stun also blocks headbutt, J, K and L.
  'status-stunned-desc':      { en: 'Cannot move or act for a brief window.',
                                es: 'Ni se mueve ni actúa durante un instante.' },
  'status-vulnerable':        { en: 'Vulnerable',               es: 'Vulnerable' },
  // ×4 = FEEL.collision.stunnedVulnerability (physics.ts); keep in step.
  'status-vulnerable-desc':   { en: 'Hits push four times as hard.',
                                es: 'Cada golpe empuja cuatro veces más.' },
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
  // Etiquetas de las barras de stats del info pane (character-select.ts)
  'select-stat-speed':        { en: 'Speed',                    es: 'Velocidad' },
  'select-stat-weight':       { en: 'Weight',                   es: 'Peso' },
  'select-stat-power':        { en: 'Power',                    es: 'Fuerza' },

  // ---- Toast de cinturón nuevo (badge-toast.ts) ----------------------------
  'belt-toast-label':         { en: 'NEW BELT UNLOCKED',        es: '¡CINTURÓN NUEVO!' },

  // ---- Salón de los Cinturones (hall-of-belts.ts) ---------------------------
  // Los nombres de los cinturones son propios y no se traducen.
  'belts-title':              { en: '🏆 Hall of Belts',          es: '🏆 Salón de los Cinturones' },
  'belts-dialog':             { en: 'Hall of Belts',             es: 'Salón de los Cinturones' },
  'belts-tab-offline':        { en: 'Offline ({n})',             es: 'Local ({n})' },
  'belts-tab-online':         { en: 'Online ({n})',              es: 'Online ({n})' },
  'belts-close':              { en: 'Close',                     es: 'Cerrar' },
  // [html] <kbd> incrustado
  'belts-footer':             { en: '<kbd>B</kbd> or <kbd>Esc</kbd> to close · hover a belt for details',
                                es: '<kbd>B</kbd> o <kbd>Esc</kbd> para cerrar · pasa por encima de un cinturón para ver el detalle' },
  'belts-progress':           { en: '{won} / {total} unlocked',  es: '{won} / {total} conseguidos' },
  'belts-loading':            { en: 'Loading leaderboards…',     es: 'Cargando clasificaciones…' },
  'belts-playing-as':         { en: 'Playing as {nick}',         es: 'Juegas como {nick}' },
  // Va en la cabecera, en un hueco estrecho: corto.
  'belts-no-nick':            { en: 'No nickname yet — pick one in Online Multiplayer to compete',
                                es: 'Elige un nick en Online para competir' },
  'belts-error':              { en: 'Could not reach the server. Try again in a moment.',
                                es: 'No se ha podido conectar con el servidor. Prueba otra vez en un momento.' },
  'belts-holder':             { en: 'Current holder:',           es: 'En manos de:' },
  'belts-nobody':             { en: 'Nobody yet — be the first', es: 'Nadie todavía: ¡estrénalo tú!' },
  'belts-no-rankings':        { en: 'No rankings yet',           es: 'Aún no hay clasificación' },
  'belts-preview':            { en: '{name} preview',            es: 'Vista de {name}' },
  // Criterio y formato de los 5 cinturones online (hall-of-belts.ts y
  // online-belt-toast.ts, que lo espeja)
  'belts-crit-throne':        { en: 'Most online wins',          es: 'Más victorias online' },
  'belts-crit-flash':         { en: 'Fastest online win',        es: 'Victoria online más rápida' },
  'belts-crit-ironclad':      { en: 'Best lives-per-match ratio (min 5 matches)',
                                es: 'Mejor media de vidas por partida (mín. 5 partidas)' },
  'belts-crit-slayer':        { en: 'Most human kills',          es: 'Más bajas de humanos' },
  'belts-crit-hot-streak':    { en: 'Longest win streak',        es: 'Racha de victorias más larga' },
  // Singular aparte (tPlural): «1 victoria», no «1 victorias».
  'belts-fmt-wins':           { en: '{n} wins',                  es: '{n} victorias' },
  'belts-fmt-wins-one':       { en: '{n} win',                   es: '{n} victoria' },
  'belts-fmt-lives':          { en: '{v} lives/match',           es: '{v} vidas/partida' },
  'belts-fmt-lives-matches':  { en: '{v} lives/match ({m} matches)', es: '{v} vidas/partida ({m} partidas)' },
  'belts-fmt-kills':          { en: '{n} kills',                 es: '{n} bajas' },
  'belts-fmt-kills-one':      { en: '{n} kill',                  es: '{n} baja' },
  'belts-fmt-streak':         { en: '{n} in a row',              es: '{n} seguidas' },
  'belts-fmt-streak-one':     { en: '{n} in a row',              es: '{n} seguida' },

  // ---- Toast de cinturón online (online-belt-toast.ts) -----------------------
  // [html] {belt} y {nick} llegan ya escapados y con su <strong>
  'belt-online-mine-head':    { en: '🏆 You took a belt!',       es: '🏆 ¡Te has hecho con un cinturón!' },
  'belt-online-head':         { en: 'Belt changed hands',        es: 'El cinturón cambia de manos' },
  'belt-online-mine-body':    { en: 'You now hold the {belt}',   es: 'Ahora tienes el {belt}' },
  'belt-online-other-body':   { en: '{nick} now holds the {belt}', es: '{nick} tiene ahora el {belt}' },

  // ---- Visor 3D del cinturón (belt-viewer.ts) --------------------------------
  'belt-viewer-dialog':       { en: 'Belt preview',              es: 'Vista del cinturón' },
  'belt-viewer-hint':         { en: 'Drag to rotate · click outside to close',
                                es: 'Arrastra para girar · pulsa fuera para cerrar' },
  'belt-viewer-failed':       { en: '(model failed to load — view artwork in the grid)',
                                es: '(no se ha podido cargar el modelo: mira la ilustración en la cuadrícula)' },
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

/** tf() with `{n}`, using the `-one` key when n is 1 ('belts-fmt-wins' →
 *  'belts-fmt-wins-one') if it exists. */
export function tPlural(key: I18nKey, n: number): string {
  const one = `${key}-one`;
  return tf(n === 1 && one in DICT ? (one as I18nKey) : key, { n });
}

// ---------------------------------------------------------------------------
// Contenido de juego — rol, lema y descripción de habilidad de cada bicho,
// y la descripción de cada cinturón
// ---------------------------------------------------------------------------
//
// Ese texto vive en inglés en el código (src/roster.ts y src/abilities.ts de
// PERSONAJES; src/badges.ts, con umbrales en plantilla), no en index.html.
// No se copia a DICT: se traduce POR EL
// PROPIO TEXTO INGLÉS, como un msgid de gettext. Si PERSONAJES cambia una
// frase, su traducción deja de casar y se ve el inglés nuevo — nunca una
// traducción que ya no corresponde. tests/sim/i18n-content.test.ts avisa
// de lo que quede sin traducir.
// Los nombres propios (bichos, habilidades) no pasan por aquí: no se
// traducen (contrato de la cabecera). Los lemas en castellano evitan el
// género: no está fijado para cada bicho.

export const CONTENT_ES: Readonly<Record<string, string>> = {
  // Roles
  'Bruiser':      'Matón',
  'Trickster':    'Pícaro',
  'Balanced':     'Todoterreno',
  'Tank':         'Tanque',
  'Controller':   'Control',
  'Trapper':      'Trampero',
  'Mage':         'Mago',
  'Assassin':     'Asesino',
  'Glass Cannon': 'Cañón de cristal',
  // Lemas
  'Huge and unstoppable.':           'Enorme e imparable.',
  'Fast, sly, unpredictable.':       'Velocidad, astucia y sorpresa.',
  'Strong and agile. No weakness.':  'Fuerza y agilidad. Sin puntos débiles.',
  'Heavy and wise.':                 'Peso y sabiduría.',
  'Venomous area denial.':           'Niega el terreno a base de veneno.',
  'Digs in. Controls ground.':       'Excava. Domina el terreno.',
  'Calculated ranged threat.':       'Peligro a distancia, bien calculado.',
  'Swift and lethal.':               'Veloz y letal.',
  'One giant claw. All in.':         'Una pinza gigante. Todo o nada.',
  // Habilidades — Trunk
  'Unstoppable forward dash with tusks':
    'Embestida imparable con los colmillos',
  'Wide AoE thump — knocks back and stuns':
    'Pisotón en área — empuja y aturde',
  'Trunk pulls and stuns a target for 2.5 s — it takes ×4 from any hit':
    'La trompa atrae y aturde a un rival 2,5 s — recibe ×4 de cualquier golpe',
  // Kurama
  'Blink-fast feint through enemies':
    'Finta relámpago que atraviesa a los rivales',
  'Leave a decoy, ghost away from danger for 2.8 s':
    'Deja un señuelo y se esfuma del peligro durante 2,8 s',
  'Mimics the L of the last enemy you hit':
    'Copia la L del último rival al que golpeaste',
  // Sergei
  'Heavy palm strike charge':
    'Carga con un manotazo demoledor',
  'Slams ground with both fists — heavy radial knockback':
    'Aporrea el suelo con los dos puños — gran empuje en círculo',
  'Enters berserk mode: +speed, +power, near-immovable':
    'Modo furia: +velocidad, +fuerza, casi inamovible',
  // Shelly
  'Slow rolling ram':
    'Embestida rodando, lenta pero firme',
  'Lock into the shell — invulnerable for 4 s':
    'Se encierra en el caparazón — invulnerable durante 4 s',
  'Spin like a saw — every contact launches enemies hard':
    'Gira como una sierra — cada roce manda lejos al rival',
  // Kermit
  'Tongue-propelled lunge':
    'Salto impulsado por la lengua',
  'Toxic fog that lingers and slows enemies':
    'Niebla tóxica que se queda y frena a los rivales',
  'Touch enemies to invert their controls':
    'Toca a los rivales para invertirles los controles',
  // Sihans
  'Underground charge resurfacing ahead':
    'Carga bajo tierra que asoma más adelante',
  'Burrow under, leave quicksand, surface ahead':
    'Se entierra, deja arenas movedizas y sale más adelante',
  'Open a hazardous pit ahead — pulls enemies in':
    'Abre un socavón delante — arrastra dentro a los rivales',
  // Kowalski
  'Belly-slides forward and keeps gliding':
    'Se lanza de panza y sigue deslizándose',
  'Frontal snowball — knocks back and freezes the target for 5 s':
    'Bola de nieve frontal — empuja y congela al objetivo durante 5 s',
  'Coats the ground in ice — enemies slip and slide':
    'Cubre el suelo de hielo — los rivales patinan sin control',
  // Cheeto
  'Lightning-fast predator lunge':
    'Salto de depredador, rápido como un rayo',
  'Teleport onto the nearest target — knock them out':
    'Se teletransporta sobre el rival más cercano — y lo tumba',
  'Channels a roaring frontal pulse — escalating push':
    'Canaliza un rugido frontal — empuje cada vez mayor',
  // Sebastian
  'Sideways scuttle charge':
    'Carga de lado, a lo cangrejo',
  'Frontal claw shockwave — heavy frontal knockback':
    'Onda de choque con la pinza — fuerte empuje frontal',
  'Charge then strike — devastating on hit, costly on miss':
    'Carga y golpea — devastador si acierta, caro si falla',
  // Cinturones (src/badges.ts): la descripción de cada uno. Los nombres
  // son propios y no se traducen. Las de campeón salen de una plantilla
  // con el umbral (CHAMPION_WINS_THRESHOLD): si cambia, el test avisa.
  'Win 5 matches with Sergei.':     'Gana 5 partidas con Sergei.',
  'Win 5 matches with Trunk.':      'Gana 5 partidas con Trunk.',
  'Win 5 matches with Kurama.':     'Gana 5 partidas con Kurama.',
  'Win 5 matches with Shelly.':     'Gana 5 partidas con Shelly.',
  'Win 5 matches with Kermit.':     'Gana 5 partidas con Kermit.',
  'Win 5 matches with Sihans.':     'Gana 5 partidas con Sihans.',
  'Win 5 matches with Kowalski.':   'Gana 5 partidas con Kowalski.',
  'Win 5 matches with Cheeto.':     'Gana 5 partidas con Cheeto.',
  'Win 5 matches with Sebastian.':  'Gana 5 partidas con Sebastian.',
  'Win a match in 30 seconds or less.':
    'Gana una partida en 30 segundos o menos.',
  'Win a match without losing a single life.':
    'Gana una partida sin perder ni una vida.',
  'Win a match without taking a single headbutt.':
    'Gana una partida sin recibir ni un cabezazo.',
  'Reach 20 total wins across the roster.':
    'Suma 20 victorias entre todos los bichos.',
  'Win at least one match with every playable critter.':
    'Gana al menos una partida con cada bicho jugable.',
  'Win a match with only one life left (comeback victory).':
    'Gana una partida con una sola vida (remontada).',
  'Win at least one match after taking 10+ headbutts.':
    'Gana al menos una partida tras recibir 10 cabezazos o más.',
};

/** Texto de contenido de juego (ver arriba) en el idioma activo; sin
 *  traducción, el fuente inglés tal cual. */
export function tContent(source: string): string {
  return getLang() === 'es' ? (CONTENT_ES[source] ?? source) : source;
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
