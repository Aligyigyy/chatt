const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const users = {};
const userRooms = {};
const userIPs = {};
const userLastActive = {};
const MESSAGE_MAX_LENGTH = 50;
const USERNAME_MAX_LENGTH = 5;
const ROOM_NAME_MAX_LENGTH = 7;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const activeVoiceCalls = new Map();
const INACTIVE_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

const BANNED_WORDS = ['zaml', '5tk ana', 'mok ana', '9a7ba', 'zab', '5tk', '5tak', 'aliw9', 'w9', '9lawi', 't7awa'];

function containsBannedWords(text) {
    return BANNED_WORDS.some(word =>
        text.toLowerCase().includes(word.toLowerCase())
    );
}

// دالة لتحديث وقت النشاط للمستخدم
function updateUserActivity(socketId) {
    userLastActive[socketId] = Date.now();
}

// دالة للتحقق من المستخدمين غير النشطين
function checkInactiveUsers() {
    const currentTime = Date.now();
    Object.keys(userLastActive).forEach(socketId => {
        if (currentTime - userLastActive[socketId] > INACTIVE_TIMEOUT) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
                socket.emit('message', {
                    user: 'النظام',
                    text: 'تم قطع اتصالك بسبب عدم النشاط'
                });
                socket.disconnect(true);
            }
        }
    });
}

// فحص المستخدمين غير النشطين كل دقيقة
setInterval(checkInactiveUsers, 60000);

function printUsersInfo() {
    console.clear();
    const currentTime = new Date().toLocaleTimeString('ar-SA');
    console.log('\n=== معلومات المتصلين ===');
    console.log(`الوقت الحالي: ${currentTime}`);
    console.log(`إجمالي عدد المتصلين: ${Object.keys(users).length}`);
    console.log('------------------------');

    const roomUsers = {};
    Object.keys(userRooms).forEach(socketId => {
        const room = userRooms[socketId];
        if (!roomUsers[room]) {
            roomUsers[room] = [];
        }
        const lastActiveTime = new Date(userLastActive[socketId]).toLocaleTimeString('ar-SA');
        roomUsers[room].push({
            username: users[socketId],
            ip: userIPs[socketId],
            lastActive: lastActiveTime
        });
    });

    Object.keys(roomUsers).forEach(room => {
        console.log(`\nالغرفة: ${room}`);
        console.log(`عدد المستخدمين: ${roomUsers[room].length}`);
        roomUsers[room].forEach(user => {
            console.log(`- ${user.username} (IP: ${user.ip}) | آخر نشاط: ${user.lastActive}`);
        });
        console.log('------------------------');
    });
}

io.on('connection', (socket) => {
    const clientIP = socket.handshake.headers['x-forwarded-for'] ||
        socket.handshake.address;
    userIPs[socket.id] = clientIP;
    updateUserActivity(socket.id);

    console.log(`مستخدم جديد متصل - IP: ${clientIP}`);
    printUsersInfo();

    socket.on('joinRoom', ({ username, room }) => {
        if (containsBannedWords(username) || containsBannedWords(room)) {
            socket.emit('message', {
                user: 'النظام',
                text: 'تم حظرك من الدردشة لاستخدام كلمات غير لائقة'
            });
            socket.disconnect(true);
            return;
        }

        if (username.length > USERNAME_MAX_LENGTH || room.length > ROOM_NAME_MAX_LENGTH) {
            socket.emit('message', {
                user: 'النظام',
                text: `عذراً، تجاوزت الحد المسموح للأحرف`
            });
            return;
        }

        // التحقق من وجود نفس اسم المستخدم في الغرفة
        const existingUser = Object.entries(users).find(([id, name]) =>
            name === username && userRooms[id] === room && id !== socket.id
        );

        if (existingUser) {
            socket.emit('message', {
                user: 'النظام',
                text: 'عذراً، هذا الاسم مستخدم بالفعل في هذه الغرفة'
            });
            return;
        }

        socket.join(room);
        users[socket.id] = username;
        userRooms[socket.id] = room;
        updateUserActivity(socket.id);

        socket.emit('message', {
            user: 'النظام',
            text: `أهلاً بك ${username} في غرفة ${room}`
        });

        socket.broadcast.to(room).emit('message', {
            user: 'النظام',
            text: `${username} انضم إلى الغرفة`
        });

        io.to(room).emit('roomUsers', {
            users: getUsersInRoom(room)
        });

        printUsersInfo();
    });

    socket.on('imageMessage', ({ username, room, image }) => {
        updateUserActivity(socket.id);
        if (!image || !image.startsWith('data:image/')) {
            socket.emit('message', {
                user: 'النظام',
                text: 'نوع الملف غير مدعوم'
            });
            return;
        }

        const base64Size = Buffer.from(image.split(',')[1], 'base64').length;
        if (base64Size > MAX_IMAGE_SIZE) {
            socket.emit('message', {
                user: 'النظام',
                text: 'حجم الصورة كبير جداً'
            });
            return;
        }

        io.to(room).emit('imageMessage', {
            user: username,
            image: image
        });
    });

    socket.on('voiceMessage', ({ username, room, audioData }) => {
        updateUserActivity(socket.id);
        io.to(room).emit('voiceMessage', {
            user: username,
            audioData: audioData
        });
    });

    socket.on('chatMessage', (message) => {
        updateUserActivity(socket.id);
        const room = userRooms[socket.id];

        if (message.length > MESSAGE_MAX_LENGTH) {
            socket.emit('message', {
                user: 'النظام',
                text: `عذراً، لا يمكن إرسال رسالة أطول من ${MESSAGE_MAX_LENGTH} حرف`
            });
            return;
        }

        if (containsBannedWords(message)) {
            socket.emit('message', {
                user: 'النظام',
                text: 'تم حظر الرسالة لاحتوائها على كلمات غير لائقة'
            });
            return;
        }

        io.to(room).emit('message', {
            user: users[socket.id],
            text: message
        });
    });

    socket.on('typing', ({ username, room }) => {
        updateUserActivity(socket.id);
        socket.broadcast.to(room).emit('userTyping', username);
    });

    socket.on('stopTyping', ({ username, room }) => {
        updateUserActivity(socket.id);
        socket.broadcast.to(room).emit('userStopTyping', username);
    });

    socket.on('disconnect', () => {
        const room = userRooms[socket.id];
        const username = users[socket.id];

        const activeCallPeer = activeVoiceCalls.get(socket.id);
        if (activeCallPeer) {
            io.to(activeCallPeer).emit('callEnded', {
                username: username
            });
            activeVoiceCalls.delete(activeCallPeer);
            activeVoiceCalls.delete(socket.id);
        }

        if (username) {
            io.to(room).emit('message', {
                user: 'النظام',
                text: `${username} غادر الغرفة`
            });

            delete users[socket.id];
            delete userRooms[socket.id];
            delete userIPs[socket.id];
            delete userLastActive[socket.id];

            io.to(room).emit('roomUsers', {
                users: getUsersInRoom(room)
            });

            printUsersInfo();
        }
    });
});

function getUsersInRoom(room) {
    const socketsInRoom = io.sockets.adapter.rooms.get(room);
    if (!socketsInRoom) return [];

    return Array.from(socketsInRoom).map(socketId => ({
        username: users[socketId],
        id: socketId
    }));
}

const PORT = process.env.PORT || 1530;
server.listen(PORT, () => {
    console.log(`\n=== معلومات الخادم ===`);
    console.log(`تم تشغيل الخادم على المنفذ: ${PORT}`);
    console.log(`الوقت: ${new Date().toLocaleTimeString('ar-SA')}`);
    console.log('انتظار اتصال المستخدمين...\n');
});