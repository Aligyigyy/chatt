const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});

let users = {};

io.on("connection", (socket) => {
    console.log("🔵 مستخدم جديد متصل");

    socket.on("joinRoom", ({ username, room }) => {
        socket.join(room);
        users[socket.id] = { username, room };

        io.to(room).emit("message", { user: "🔔", text: `${username} دخل إلى الغرفة` });
        io.to(room).emit("roomUsers", {
            room: room,
            users: Object.values(users).filter(user => user.room === room)
        });
    });

    socket.on("chatMessage", (msg) => {
        const user = users[socket.id];
        if (user) io.to(user.room).emit("message", { user: user.username, text: msg });
    });

    socket.on("disconnect", () => {
        const user = users[socket.id];
        if (user) {
            io.to(user.room).emit("message", { user: "🔴", text: `${user.username} خرج من الغرفة` });
            delete users[socket.id];

            io.to(user.room).emit("roomUsers", {
                room: user.room,
                users: Object.values(users).filter(u => u.room === user.room)
            });
        }
    });
});

server.listen(1523, '192.168.11.102', () => {
    console.log(`Server running on port 1523`);
});

