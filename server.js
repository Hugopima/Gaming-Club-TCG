/**
 * Servidor multijugador para Gaming Club TCG
 * 
 * Funciones:
 * 1. Sirve los archivos estáticos (juego.html, cartas.json, imagenes/)
 * 2. Matchmaking automático (busca rival aleatorio)
 * 3. Salas privadas con código (jugar con amigos)
 * 4. Sincroniza acciones entre jugadores
 * 5. Login con Discord (OAuth2)
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Parse JSON bodies (para los endpoints de Discord OAuth y Supabase)
app.use(express.json());

// Servir archivos estáticos desde la carpeta actual
app.use(express.static(__dirname));

// Función auxiliar: resolver la ruta del juego.html
// (puede llamarse juego.html o index.html según el deploy)
function getJuegoPath() {
    const fs = require('fs');
    const candidatos = [
        path.join(__dirname, 'juego.html'),
        path.join(__dirname, 'index.html'),
        path.join(process.cwd(), 'juego.html'),
        path.join(process.cwd(), 'index.html')
    ];
    for (const p of candidatos) {
        if (fs.existsSync(p)) return p;
    }
    return path.join(__dirname, 'juego.html');
}

// Ruta principal: servir el juego
app.get('/', (req, res) => {
    res.sendFile(getJuegoPath());
});

// Ruta de callback de Discord: sirve el juego, que detectara ?code= en la URL
// y llamara a /auth/discord para intercambiar el code por el token.
app.get('/auth/discord/callback', (req, res) => {
    res.sendFile(getJuegoPath());
});

// === DISCORD OAUTH2 ===
// IMPORTANTE: Configura estas variables de entorno en Render:
//   DISCORD_CLIENT_ID     = tu Client ID de Discord
//   DISCORD_CLIENT_SECRET = tu Client Secret de Discord
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || 'TU_CLIENT_ID_AQUI';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'TU_CLIENT_SECRET_AQUI';

// === SUPABASE ===
// IMPORTANTE: Configura estas variables de entorno en Render:
//   SUPABASE_URL       = tu Project URL de Supabase
//   SUPABASE_ANON_KEY  = tu anon public key de Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('✅ Supabase conectado');
} else {
    console.warn('⚠️ Supabase no configurado (falta SUPABASE_URL o SUPABASE_ANON_KEY)');
}

// Inventario por defecto para nuevos usuarios
function inventarioDefault(username) {
    return {
        coins: 0,
        energy: 0,
        cartas: {},
        stats: {
            partidasJugadas: 0, victoriasIA: 0, victoriasOnline: 0, derrotas: 0,
            mejorRacha: 0, rachaActual: 0, sobresAbiertos: 0,
            despertares: 0, cartasFabricadas: 0, cartasRecicladas: 0,
            counterPlays: 0, bloqueadores: 0,
            cartasUnicas: 0, comunesUnicas: 0, infrecuentesUnicas: 0, rarasUnicas: 0, superRarasUnicas: 0,
            logrosReclamados: [],
            ultimoLogin: null, loginClaimedHoy: false, primeraVictoriaHoy: false,
            tutorialRewardClaimed: false
        },
        misiones: {
            diarias: [],
            semanales: [],
            fechaDiarias: null,
            fechaSemanales: null
        },
        mazos: [],
        amigos: [],
        cartaFavorita: null,
        tituloActivo: null,
        perfil: { bio: '' },
        // Sistema de maestrías de cartas: { cardId: { m1: 0|1|2, m2: 0|1|2, m3: 0|1, progreso: {...}, tituloReclamado: bool } }
        maestrias: {},
        // Títulos desbloqueados por maestrías (IDs: 'maestria_<cardId>')
        titulosDesbloqueados: []
    };
}

// Cargar o crear inventario en Supabase
async function cargarOCrearInventario(discordId, username) {
    if (!supabase) {
        console.error('[Supabase] Cliente no inicializado');
        return null;
    }
    try {
        // Intentar cargar
        const { data, error } = await supabase
            .from('inventarios')
            .select('*')
            .eq('discord_id', discordId)
            .single();
        
        // Si hay data, devolverla
        if (data) {
            // Actualizar username por si cambió
            if (username && data.username !== username) {
                await supabase.from('inventarios').update({ username, updated_at: new Date() }).eq('discord_id', discordId);
                data.username = username;
            }
            return data;
        }
        
        // No existe: crear nuevo
        console.log('[Supabase] Creando nuevo inventario para', discordId);
        const nuevoInv = inventarioDefault(username || 'Jugador');
        const { data: nuevo, error: errInsert } = await supabase
            .from('inventarios')
            .insert({
                discord_id: discordId,
                username: username || 'Jugador',
                coins: nuevoInv.coins,
                energy: nuevoInv.energy,
                cartas: nuevoInv.cartas,
                stats: nuevoInv.stats,
                misiones: nuevoInv.misiones,
                mazos: nuevoInv.mazos
            })
            .select()
            .single();
        
        if (errInsert) {
            console.error('[Supabase] Error creando inventario:', JSON.stringify(errInsert));
            return null;
        }
        console.log('[Supabase] Inventario creado correctamente:', nuevo.discord_id);
        return nuevo;
    } catch (e) {
        console.error('[Supabase] Error en cargarOCrearInventario:', e.message);
        return null;
    }
}

// fetch nativo (Node 18+). Si usas Node < 18, instala node-fetch: npm install node-fetch
const fetch = global.fetch || require('node-fetch').default;

// Endpoint: intercambiar el code de Discord por un token de acceso y los datos del usuario
app.post('/auth/discord', async (req, res) => {
    try {
        const { code, redirect_uri } = req.body;
        if (!code) return res.status(400).json({ error: 'Falta el codigo de Discord' });

        // Verificar que las credenciales están configuradas
        if (DISCORD_CLIENT_ID === 'TU_CLIENT_ID_AQUI' || DISCORD_CLIENT_SECRET === 'TU_CLIENT_SECRET_AQUI') {
            return res.status(500).json({ error: 'Faltan las variables de entorno DISCORD_CLIENT_ID y/o DISCORD_CLIENT_SECRET en Render' });
        }

        // 1. Intercambiar code por access_token
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirect_uri
            })
        });
        if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            console.error('Error token Discord:', errText);
            return res.status(400).json({ error: 'Error al obtener token de Discord', details: errText });
        }
        const tokenData = await tokenRes.json();

        // 2. Obtener los datos del usuario con el access_token
        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: tokenData.token_type + ' ' + tokenData.access_token }
        });
        if (!userRes.ok) {
            return res.status(400).json({ error: 'Error al obtener datos del usuario' });
        }
        const userData = await userRes.json();

        // 3. Cargar o crear inventario en Supabase
        const inventario = await cargarOCrearInventario(userData.id, userData.username);

        // 4. Devolver los datos al cliente (usuario + inventario)
        res.json({
            user: {
                id: userData.id,
                username: userData.username,
                avatar: userData.avatar,
                email: userData.email
            },
            inventario: inventario
        });
    } catch (e) {
        console.error('Error en /auth/discord:', e);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// === ENDPOINTS DE INVENTARIO (SUPABASE) ===

// Guardar inventario completo
app.post('/api/guardar-inventario', async (req, res) => {
    try {
        const { discord_id, coins, energy, cartas, stats, misiones, mazos, amigos, cartaFavorita, tituloActivo, perfil } = req.body;
        if (!discord_id) return res.status(400).json({ error: 'Falta discord_id' });
        if (!supabase) return res.status(500).json({ error: 'Supabase no configurado' });

        // Primero verificar si ya existe
        const { data: existente } = await supabase
            .from('inventarios')
            .select('discord_id')
            .eq('discord_id', discord_id)
            .single();

        let resultado;
        if (existente) {
            // Actualizar
            const { data, error } = await supabase
                .from('inventarios')
                .update({
                    coins: coins,
                    energy: energy,
                    cartas: cartas || {},
                    stats: stats || {},
                    misiones: misiones || {},
                    mazos: mazos || [],
                    amigos: amigos || [],
                    cartaFavorita: cartaFavorita || null,
                    tituloActivo: tituloActivo || null,
                    perfil: perfil || { bio: '' },
                    updated_at: new Date()
                })
                .eq('discord_id', discord_id)
                .select()
                .single();
            resultado = { data, error };
        } else {
            // Insertar nuevo
            const { data, error } = await supabase
                .from('inventarios')
                .insert({
                    discord_id: discord_id,
                    username: 'Jugador',
                    coins: coins,
                    energy: energy,
                    cartas: cartas || {},
                    stats: stats || {},
                    misiones: misiones || {},
                    mazos: mazos || [],
                    amigos: amigos || [],
                    cartaFavorita: cartaFavorita || null,
                    tituloActivo: tituloActivo || null,
                    perfil: perfil || { bio: '' },
                    updated_at: new Date()
                })
                .select()
                .single();
            resultado = { data, error };
        }

        if (resultado.error) {
            console.error('[Supabase] Error guardando inventario:', JSON.stringify(resultado.error));
            return res.status(500).json({ error: 'Error al guardar inventario', details: resultado.error.message });
        }
        res.json({ success: true, inventario: resultado.data });
    } catch (e) {
        console.error('[Supabase] Error en /api/guardar-inventario:', e.message);
        res.status(500).json({ error: 'Error interno del servidor', details: e.message });
    }
});

// Cargar inventario (siempre crea si no existe)
app.post('/api/cargar-inventario', async (req, res) => {
    try {
        const { discord_id } = req.body;
        if (!discord_id) return res.status(400).json({ error: 'Falta discord_id' });
        if (!supabase) return res.status(500).json({ error: 'Supabase no configurado' });

        const inventario = await cargarOCrearInventario(discord_id, '');
        if (!inventario) {
            console.error('[Supabase] No se pudo cargar/crear inventario para', discord_id);
            return res.status(500).json({ error: 'No se pudo cargar ni crear el inventario' });
        }
        res.json({ inventario });
    } catch (e) {
        console.error('[Supabase] Error en /api/cargar-inventario:', e.message);
        res.status(500).json({ error: 'Error interno del servidor', details: e.message });
    }
});

// === SISTEMA DE MATCHMAKING Y SALAS ===

const colaEspera = [];          // Jugadores buscando partida aleatoria
const salasPrivadas = new Map(); // codigo -> { host, invitado, roomId }
const partidasActivas = new Map(); // roomId -> { jugador1, jugador2 }

// === SISTEMA DE AMIGOS Y PERFIL ===
// Mapa de discord_id -> Set(socket.id) para saber quién está online
const usuariosConectados = new Map();

// Registrar un usuario cuando se conecta (asocia discord_id al socket)
function registrarUsuarioConectado(discordId, socket) {
    if (!discordId) return;
    if (!usuariosConectados.has(discordId)) {
        usuariosConectados.set(discordId, new Set());
    }
    usuariosConectados.get(discordId).add(socket.id);
}

// Desregistrar un socket al desconectarse
function desregistrarSocket(socket) {
    for (const [discordId, sockets] of usuariosConectados.entries()) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
            usuariosConectados.delete(discordId);
        }
    }
}

// Comprobar si un discord_id está online
function estaOnline(discordId) {
    return usuariosConectados.has(discordId);
}

// Endpoint: buscar usuario por username (para añadir amigos)
app.post('/api/buscar-usuario', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username || !supabase) return res.status(400).json({ error: 'Falta username o Supabase no configurado' });
        // Buscar en Supabase por username (coincidencia exacta o parcial)
        const { data, error } = await supabase
            .from('inventarios')
            .select('discord_id, username, cartaFavorita, perfil, stats')
            .ilike('username', '%' + username + '%')
            .limit(10);
        if (error) return res.status(500).json({ error: error.message });
        // Devolver lista de resultados (sin datos sensibles)
        res.json({ resultados: (data || []).map(u => ({
            discord_id: u.discord_id,
            username: u.username,
            online: estaOnline(u.discord_id)
        })) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Endpoint: obtener perfil público de un usuario (por discord_id)
app.post('/api/perfil', async (req, res) => {
    try {
        const { discord_id } = req.body;
        if (!discord_id || !supabase) return res.status(400).json({ error: 'Falta discord_id' });
        const { data, error } = await supabase
            .from('inventarios')
            .select('discord_id, username, cartaFavorita, tituloActivo, perfil, stats, cartas')
            .eq('discord_id', discord_id)
            .single();
        if (error || !data) return res.status(404).json({ error: 'Usuario no encontrado' });
        // Perfil público: username, carta favorita, stats, total cartas
        const totalCartas = Object.values(data.cartas || {}).reduce((s, n) => s + n, 0);
        const cartasUnicas = Object.keys(data.cartas || {}).filter(id => {
            const c = data.cartas[id];
            return c > 0;
        }).length;
        res.json({
            perfil: {
                discord_id: data.discord_id,
                username: data.username,
                cartaFavorita: data.cartaFavorita || null,
                tituloActivo: data.tituloActivo || null,
                bio: (data.perfil && data.perfil.bio) || '',
                online: estaOnline(data.discord_id),
                stats: {
                    partidasJugadas: (data.stats && data.stats.partidasJugadas) || 0,
                    victoriasIA: (data.stats && data.stats.victoriasIA) || 0,
                    victoriasIADificil: (data.stats && data.stats.victoriasIADificil) || 0,
                    victoriasOnline: (data.stats && data.stats.victoriasOnline) || 0,
                    derrotas: (data.stats && data.stats.derrotas) || 0,
                    mejorRacha: (data.stats && data.stats.mejorRacha) || 0,
                    rachaActual: (data.stats && data.stats.rachaActual) || 0,
                    sobresAbiertos: (data.stats && data.stats.sobresAbiertos) || 0,
                    despertares: (data.stats && data.stats.despertares) || 0,
                    cartasFabricadas: (data.stats && data.stats.cartasFabricadas) || 0,
                    cartasRecicladas: (data.stats && data.stats.cartasRecicladas) || 0,
                    counterPlays: (data.stats && data.stats.counterPlays) || 0,
                    bloqueadores: (data.stats && data.stats.bloqueadores) || 0,
                    cartasUnicas: (data.stats && data.stats.cartasUnicas) || 0,
                    // BUG FIX: faltaban copas y partidasCompetitivas en el perfil público,
                    // así que los amigos siempre veían "0 copas" aunque el jugador tuviera.
                    copas: (data.stats && data.stats.copas) || 0,
                    partidasCompetitivas: (data.stats && data.stats.partidasCompetitivas) || 0
                },
                totalCartas: totalCartas,
                cartasUnicas: cartasUnicas
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Generar código de 6 caracteres para sala privada
function generarCodigoSala() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Sin caracteres ambiguos (I, O, 0, 1)
    let codigo;
    do {
        codigo = '';
        for (let i = 0; i < 6; i++) {
            codigo += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (salasPrivadas.has(codigo)); // Asegurar que no se repita
    return codigo;
}

io.on('connection', (socket) => {
    console.log(`✅ Jugador conectado: ${socket.id}`);

    // === REGISTRAR USUARIO (para sistema de amigos online) ===
    socket.on('registrar-usuario', (data) => {
        if (data && data.discord_id) {
            socket.discordId = data.discord_id;
            registrarUsuarioConectado(data.discord_id, socket);
            console.log(`👤 ${socket.id} registrado como ${data.discord_id}`);
        }
    });

    // === CONSULTAR AMIGOS ONLINE ===
    socket.on('consultar-amigos-online', (data) => {
        const amigos = (data && data.amigos) || [];
        const onlineMap = {};
        amigos.forEach(id => { onlineMap[id] = estaOnline(id); });
        socket.emit('amigos-online-resultado', onlineMap);
    });

    // === BUSCAR PARTIDA ALEATORIA (matchmaking) ===
    socket.on('buscar-partida', () => {
        console.log(`🔍 ${socket.id} busca partida...`);
        // Si ya está en una sala o cola, no hacer nada
        if (socket.dataRoomId) return;
        
        // Quitar de cola si ya estaba
        const idx = colaEspera.indexOf(socket);
        if (idx >= 0) colaEspera.splice(idx, 1);

        if (colaEspera.length > 0) {
            // Hay alguien esperando, emparejar
            const rival = colaEspera.shift();
            const roomId = `partida_${Date.now()}`;
            
            partidasActivas.set(roomId, {
                jugador1: rival,
                jugador2: socket,
                tipo: 'aleatoria'
            });

            rival.join(roomId);
            socket.join(roomId);
            rival.dataRoomId = roomId;
            rival.dataPlayerNum = 1;
            socket.dataRoomId = roomId;
            socket.dataPlayerNum = 2;

            console.log(`🎮 Partida aleatoria creada: ${roomId}`);
            // Lanzar moneda para decidir quién empieza
            const empiezaJugador1 = Math.random() < 0.5;
            io.to(rival.id).emit('partida-lista', { roomId, playerNum: 1 });
            io.to(socket.id).emit('partida-lista', { roomId, playerNum: 2 });
            // Enviar resultado de la moneda a ambos
            setTimeout(() => {
                io.to(rival.id).emit('moneda-resultado', { empiezaJugador1 });
                io.to(socket.id).emit('moneda-resultado', { empiezaJugador1 });
                console.log(`🪙 Moneda lanzada en ${roomId}: empieza jugador ${empiezaJugador1 ? 1 : 2}`);
            }, 500);
        } else {
            // No hay rival, agregar a la cola
            colaEspera.push(socket);
            socket.emit('esperando-rival');
            console.log(`⏳ ${socket.id} esperando rival...`);
        }
    });

    // === CANCELAR BÚSQUEDA ===
    socket.on('cancelar-busqueda', () => {
        const idx = colaEspera.indexOf(socket);
        if (idx >= 0) colaEspera.splice(idx, 1);
        // Si estaba en una sala privada como host, eliminarla
        for (const [codigo, sala] of salasPrivadas.entries()) {
            if (sala.host === socket) {
                salasPrivadas.delete(codigo);
                if (sala.invitado) {
                    sala.invitado.emit('sala-cerrada');
                }
            }
        }
        console.log(`🚫 ${socket.id} canceló búsqueda`);
    });

    // === CREAR SALA PRIVADA ===
    socket.on('crear-sala', () => {
        // Si ya tiene una sala, no crear otra
        for (const [codigo, sala] of salasPrivadas.entries()) {
            if (sala.host === socket) {
                socket.emit('sala-creada', { roomId: codigo });
                return;
            }
        }
        const codigo = generarCodigoSala();
        salasPrivadas.set(codigo, {
            host: socket,
            invitado: null,
            roomId: codigo
        });
        socket.dataRoomId = null; // Aún no hay partida
        socket.dataSalaCodigo = codigo;
        console.log(`🔑 Sala privada creada: ${codigo} por ${socket.id}`);
        socket.emit('sala-creada', { roomId: codigo });
    });

    // === UNIRSE A SALA PRIVADA ===
    socket.on('unirse-sala', (data) => {
        const codigo = (data.codigo || '').toUpperCase();
        const sala = salasPrivadas.get(codigo);
        if (!sala) {
            socket.emit('sala-no-encontrada');
            return;
        }
        if (sala.invitado) {
            socket.emit('sala-llena');
            return;
        }
        if (sala.host === socket) {
            socket.emit('sala-llena'); // No puedes unirte a tu propia sala
            return;
        }
        
        // Unir al invitado
        sala.invitado = socket;
        const roomId = `sala_${codigo}_${Date.now()}`;
        
        partidasActivas.set(roomId, {
            jugador1: sala.host,
            jugador2: socket,
            tipo: 'privada',
            codigo: codigo
        });

        sala.host.join(roomId);
        socket.join(roomId);
        sala.host.dataRoomId = roomId;
        sala.host.dataPlayerNum = 1;
        socket.dataRoomId = roomId;
        socket.dataPlayerNum = 2;

        console.log(`🎮 Partida privada creada: ${roomId} (sala ${codigo})`);
        // Lanzar moneda para decidir quién empieza
        const empiezaJugador1 = Math.random() < 0.5;
        io.to(sala.host.id).emit('partida-lista', { roomId, playerNum: 1 });
        io.to(socket.id).emit('partida-lista', { roomId, playerNum: 2 });
        setTimeout(() => {
            io.to(sala.host.id).emit('moneda-resultado', { empiezaJugador1 });
            io.to(socket.id).emit('moneda-resultado', { empiezaJugador1 });
            console.log(`🪙 Moneda lanzada en ${roomId}: empieza jugador ${empiezaJugador1 ? 1 : 2}`);
        }, 500);
        
        // Eliminar la sala privada (ya es partida activa)
        salasPrivadas.delete(codigo);
    });

    // === SINCRONIZACIÓN DE JUGADAS ===
    // Acción simple: el emisor hace algo y el rival solo lo ve
    socket.on('accion-juego', (data) => {
        const roomId = socket.dataRoomId;
        if (!roomId) return;
        socket.to(roomId).emit('accion-rival', data);
    });

    // Petición al rival: el emisor necesita que el rival decida algo
    // data = { tipo, titulo, opciones, requestToken }
    socket.on('peticion-rival', (data) => {
        const roomId = socket.dataRoomId;
        if (!roomId) return;
        socket.to(roomId).emit('peticion-rival-recibida', data);
    });

    // Respuesta del rival a una petición
    // data = { requestToken, respuesta }
    socket.on('respuesta-peticion', (data) => {
        const roomId = socket.dataRoomId;
        if (!roomId) return;
        socket.to(roomId).emit('respuesta-peticion-recibida', data);
    });

    // === RENDICIÓN ===
    socket.on('rendirse', () => {
        const roomId = socket.dataRoomId;
        if (!roomId) return;
        // Notificar al rival que ganó
        socket.to(roomId).emit('rival-rendido');
        partidasActivas.delete(roomId);
        // Limpiar dataRoomId de AMBOS jugadores para que puedan buscar nueva partida
        socket.dataRoomId = null;
        socket.dataPlayerNum = null;
        const sala = io.sockets.adapter.rooms.get(roomId);
        if (sala) {
            sala.forEach(sid => {
                const s = io.sockets.sockets.get(sid);
                if (s && s.id !== socket.id) {
                    s.dataRoomId = null;
                    s.dataPlayerNum = null;
                }
            });
        }
        console.log(`🏳️ ${socket.id} se rindió en ${roomId}`);
    });

    // === RECLAMAR VICTORIA POR DESCONEXIÓN ===
    socket.on('reclamar-victoria-desconexion', () => {
        const roomId = socket.dataRoomId;
        if (!roomId) return;
        // Notificar al rival (si sigue conectado) que perdió
        socket.to(roomId).emit('victoria-desconexion');
        partidasActivas.delete(roomId);
        // Limpiar dataRoomId de AMBOS jugadores
        socket.dataRoomId = null;
        socket.dataPlayerNum = null;
        const sala = io.sockets.adapter.rooms.get(roomId);
        if (sala) {
            sala.forEach(sid => {
                const s = io.sockets.sockets.get(sid);
                if (s && s.id !== socket.id) {
                    s.dataRoomId = null;
                    s.dataPlayerNum = null;
                }
            });
        }
        console.log(`⚡ ${socket.id} reclamó victoria por desconexión en ${roomId}`);
    });

    // === PARTIDA TERMINADA (fin normal, no rendición) ===
    socket.on('partida-terminada', () => {
        const roomId = socket.dataRoomId;
        if (!roomId) return;
        partidasActivas.delete(roomId);
        // Limpiar dataRoomId de AMBOS jugadores para que puedan buscar nueva partida
        socket.dataRoomId = null;
        socket.dataPlayerNum = null;
        const sala = io.sockets.adapter.rooms.get(roomId);
        if (sala) {
            sala.forEach(sid => {
                const s = io.sockets.sockets.get(sid);
                if (s && s.id !== socket.id) {
                    s.dataRoomId = null;
                    s.dataPlayerNum = null;
                }
            });
        }
        console.log(`🏁 ${socket.id} terminó partida en ${roomId}`);
    });

    // === DESCONECTAR ===
    socket.on('disconnect', () => {
        console.log(`❌ Jugador desconectado: ${socket.id}`);
        // Desregistrar del sistema de amigos online
        desregistrarSocket(socket);
        // Quitar de cola de espera
        const idx = colaEspera.indexOf(socket);
        if (idx >= 0) colaEspera.splice(idx, 1);
        // Eliminar salas privadas donde era host
        for (const [codigo, sala] of salasPrivadas.entries()) {
            if (sala.host === socket) {
                salasPrivadas.delete(codigo);
                if (sala.invitado) {
                    sala.invitado.emit('sala-cerrada');
                }
            }
        }
        // Notificar al rival si estaba en partida
        const roomId = socket.dataRoomId;
        if (roomId) {
            // No eliminar la partida inmediatamente: dar 60 segundos para reconectar
            socket.to(roomId).emit('rival-desconectado');
            console.log(`⏳ ${socket.id} se desconectó de ${roomId}, esperando reconexión...`);

            // Guardar el timeout para poder cancelarlo si reconecta
            const partida = partidasActivas.get(roomId);
            if (partida) {
                partida.timeoutDesconexion = setTimeout(() => {
                    // Si después de 60s no reconectó, eliminar la partida
                    if (partidasActivas.has(roomId)) {
                        partidasActivas.delete(roomId);
                        console.log(`⏰ Tiempo agotado en ${roomId}`);
                    }
                }, 60000);
            }
        }
    });

    // === RECONEXIÓN ===
    socket.on('reconectar', (data) => {
        const roomId = data.roomId;
        if (!roomId) return;
        const partida = partidasActivas.get(roomId);
        if (!partida) {
            socket.emit('partida-no-existe');
            return;
        }
        // Cancelar el timeout de desconexión
        if (partida.timeoutDesconexion) {
            clearTimeout(partida.timeoutDesconexion);
            partida.timeoutDesconexion = null;
        }
        // Reconectar el socket a la sala
        socket.join(roomId);
        socket.dataRoomId = roomId;
        // Bug fix: actualizar las referencias de socket en la partida
        // para que los futuros forwardings funcionen correctamente.
        if (partida.jugador1 && partida.jugador1.connected === false) partida.jugador1 = socket;
        else if (partida.jugador2 && partida.jugador2.connected === false) partida.jugador2 = socket;
        // Notificar al rival que volvió
        socket.to(roomId).emit('rival-reconectado');
        console.log(`✅ ${socket.id} se reconectó a ${roomId}`);
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('  🎮 Gaming Club TCG - Servidor Online');
    console.log('========================================');
    console.log('');
    console.log(`✅ Servidor corriendo en el puerto ${PORT}`);
    console.log('');
    console.log('Esperando jugadores...');
    console.log('');
});
