/**
 * Servidor multijugador para Gaming Club TCG
 * 
 * Funciones:
 * 1. Sirve los archivos estáticos (juego.html, cartas.json, imagenes/)
 * 2. Matchmaking automático (busca rival aleatorio)
 * 3. Salas privadas con código (jugar con amigos)
 * 4. Sincroniza acciones entre jugadores
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir archivos estáticos desde la carpeta actual
app.use(express.static(__dirname));

// Ruta principal: servir el juego
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'juego.html'));
});

// === SISTEMA DE MATCHMAKING Y SALAS ===

const colaEspera = [];          // Jugadores buscando partida aleatoria
const salasPrivadas = new Map(); // codigo -> { host, invitado, roomId }
const partidasActivas = new Map(); // roomId -> { jugador1, jugador2 }

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
        console.log(`🏳️ ${socket.id} se rindió en ${roomId}`);
    });

    // === RECLAMAR VICTORIA POR DESCONEXIÓN ===
    socket.on('reclamar-victoria-desconexion', () => {
        const roomId = socket.dataRoomId;
        if (!roomId) return;
        // Notificar al rival (si sigue conectado) que perdió
        socket.to(roomId).emit('victoria-desconexion');
        partidasActivas.delete(roomId);
        console.log(`⚡ ${socket.id} reclamó victoria por desconexión en ${roomId}`);
    });

    // === DESCONECTAR ===
    socket.on('disconnect', () => {
        console.log(`❌ Jugador desconectado: ${socket.id}`);
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
