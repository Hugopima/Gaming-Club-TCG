/**
 * Servidor multijugador para Gaming Club TCG
 *
 * Este servidor:
 * 1. Sirve los archivos estáticos (juego.html, cartas.json, imagenes/)
 * 2. Gestiona partidas online con Socket.IO
 * 3. Empareja jugadores automáticamente
 *
 * USO:
 *   1. npm install        (instala dependencias, solo la primera vez)
 *   2. node server.js     (arranca el servidor)
 *   3. Abre http://localhost:3000 en tu navegador
 *   4. Para jugar con otra persona, dale tu IP: http://TU-IP:3000
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

// --- SISTEMA DE EMPAREJAMIENTO ---
const colaEspera = []; // Jugadores esperando rival
const partidasActivas = new Map(); // roomId -> { jugador1, jugador2, estado }

io.on('connection', (socket) => {
    console.log(`✅ Jugador conectado: ${socket.id}`);

    // Jugador busca partida
    socket.on('buscar-partida', () => {
        console.log(`🔍 ${socket.id} busca partida...`);
        if (colaEspera.length > 0) {
            // Hay alguien esperando, emparejar
            const rival = colaEspera.shift();
            const roomId = `partida_${Date.now()}`;
            const partida = {
                roomId,
                jugador1: rival,
                jugador2: socket,
                estado: 'iniciando'
            };
            partidasActivas.set(roomId, partida);

            // Unir ambos sockets a la sala
            rival.join(roomId);
            socket.join(roomId);

            // Guardar roomId en los sockets
            rival.dataRoomId = roomId;
            rival.dataPlayerNum = 1;
            socket.dataRoomId = roomId;
            socket.dataPlayerNum = 2;

            console.log(`🎮 Partida creada: ${roomId} (${rival.id} vs ${socket.id})`);

            // Notificar a ambos jugadores
            io.to(rival.id).emit('partida-lista', { roomId, playerNum: 1 });
            io.to(socket.id).emit('partida-lista', { roomId, playerNum: 2 });
        } else {
            // No hay rival, agregar a la cola
            colaEspera.push(socket);
            socket.emit('esperando-rival');
            console.log(`⏳ ${socket.id} esperando rival...`);
        }
    });

    // Recibir acción de juego y reenviar al rival
    socket.on('accion-juego', (data) => {
        const roomId = socket.dataRoomId;
        if (!roomId) return;
        // Reenviar a todos en la sala EXCEPTO el emisor
        socket.to(roomId).emit('accion-rival', data);
    });

    // Jugador se desconecta
    socket.on('disconnect', () => {
        console.log(`❌ Jugador desconectado: ${socket.id}`);
        // Quitar de la cola de espera
        const idx = colaEspera.indexOf(socket);
        if (idx >= 0) colaEspera.splice(idx, 1);
        // Notificar al rival si estaba en partida
        const roomId = socket.dataRoomId;
        if (roomId) {
            socket.to(roomId).emit('rival-desconectado');
            partidasActivas.delete(roomId);
        }
    });

    // Cancelar búsqueda de partida
    socket.on('cancelar-busqueda', () => {
        const idx = colaEspera.indexOf(socket);
        if (idx >= 0) colaEspera.splice(idx, 1);
        console.log(`🚫 ${socket.id} canceló búsqueda`);
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
    console.log(`✅ Servidor corriendo en: http://localhost:${PORT}`);
    console.log('');
    console.log('📋 Para jugar con otra persona en tu red local:');
    console.log('   1. Abre una terminal y ejecuta: ipconfig (Windows) o ifconfig (Mac/Linux)');
    console.log('   2. Busca tu IP local (ej: 192.168.1.100)');
    console.log(`   3. Dile a la otra persona que abra: http://TU-IP:${PORT}`);
    console.log('');
    console.log('⏹️  Para parar el servidor: pulsa Ctrl+C');
    console.log('');
    console.log('Esperando jugadores...');
    console.log('');
});
