// server.js
const WebSocket = require('ws');

// A simple in-memory storage for game rooms and players
const rooms = new Map();
let matchmakingQueue = [];
const PLAYER_STATE_UPDATE = 'PLAYER_STATE_UPDATE';
const GAME_START = 'GAME_START';
const PLAYER_JOINED = 'PLAYER_JOINED';
const OPPONENT_DISCONNECTED = 'OPPONENT_DISCONNECTED';
const GAME_OVER = 'GAME_OVER';

const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

console.log('WebSocket server is running on port 8080');

// Function to find a match and start a game
function findMatch() {
  if (matchmakingQueue.length >= 2) {
    const player1 = matchmakingQueue.shift();
    const player2 = matchmakingQueue.shift();

    const roomId = `room-${Date.now()}`;
    rooms.set(roomId, {
      players: [player1, player2],
      playerStates: new Map(),
    });

    // Notify both players that a match has been found
    player1.ws.send(JSON.stringify({ type: GAME_START, opponentId: player2.id, opponentName: player2.name }));
    player2.ws.send(JSON.stringify({ type: GAME_START, opponentId: player1.id, opponentName: player1.name }));

    console.log(`Game started in room ${roomId} between ${player1.name} and ${player2.name}`);
  }
}

wss.on('connection', ws => {
  const playerId = `player-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  let playerName = `Player ${Math.floor(Math.random() * 1000)}`; // Placeholder name
  let roomId = null;

  ws.on('message', message => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'JOIN_MATCHMAKING':
          playerName = data.playerName;
          ws.id = playerId;
          ws.name = playerName;
          matchmakingQueue.push({ ws, id: playerId, name: playerName });
          console.log(`${playerName} joined matchmaking.`);
          ws.send(JSON.stringify({ type: 'MATCHMAKING_STATUS', status: 'In queue...', playerId: playerId }));
          findMatch();
          break;

        case PLAYER_STATE_UPDATE:
          roomId = data.roomId;
          const room = rooms.get(roomId);
          if (room) {
            room.playerStates.set(playerId, data.state);
            // Broadcast the player's state to their opponent
            const opponent = room.players.find(p => p.id !== playerId);
            if (opponent) {
              opponent.ws.send(JSON.stringify({
                type: PLAYER_STATE_UPDATE,
                state: data.state,
                playerId: playerId,
              }));
            }
          }
          break;

        case GAME_OVER:
          roomId = data.roomId;
          const endedRoom = rooms.get(roomId);
          if (endedRoom) {
            const opponent = endedRoom.players.find(p => p.id !== playerId);
            if (opponent) {
              opponent.ws.send(JSON.stringify({ type: 'OPPONENT_CRASHED' }));
            }
            // Clean up the room
            rooms.delete(roomId);
            console.log(`Room ${roomId} ended.`);
          }
          break;
      }
    } catch (e) {
      console.error('Failed to parse message or handle event:', e);
    }
  });

  ws.on('close', () => {
    // Remove player from matchmaking queue if they are in it
    matchmakingQueue = matchmakingQueue.filter(p => p.id !== playerId);

    // Find the room the player was in and notify the opponent
    let playerRoomId = null;
    for (const [key, value] of rooms.entries()) {
      if (value.players.some(p => p.id === playerId)) {
        playerRoomId = key;
        break;
      }
    }

    if (playerRoomId) {
      const room = rooms.get(playerRoomId);
      if (room) {
        const opponent = room.players.find(p => p.id !== playerId);
        if (opponent) {
          opponent.ws.send(JSON.stringify({ type: OPPONENT_DISCONNECTED }));
        }
        rooms.delete(playerRoomId);
      }
    }

    console.log(`${playerName} disconnected.`);
  });
});
