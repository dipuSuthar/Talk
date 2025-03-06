const express = require("express");
const connectDB = require("./server/config/db");
const dotenv = require("dotenv");
const userRoutes = require("./server/routes/useRoutes");
const chatRoutes = require("./server/routes/chatRoutes");
const messageRoutes = require("./server/routes/messageRoutes");
const {
  notFound,
  errorHandler,
} = require("./server/middelware/errorMiddelware");
const path = require("path");

dotenv.config();
connectDB();
const app = express();

app.use(express.json()); // to accept json data
const cors = require("cors");

app.use(
  cors({
    origin: "http://localhost:3000", // Allow requests from frontend
    credentials: true, // Enable cookies and authentication headers
  })
);

// app.get("/", (req, res) => {
//   res.send("API Running!");
// });

app.use("/api/user", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/message", messageRoutes);

// --------------------------deployment------------------------------

// const __dirname1 = path.resolve();

// if (process.env.NODE_ENV === "production") {
//   app.use(express.static(path.join(__dirname1, "/frontend/build")));

//   app.get("*", (req, res) =>
//     res.sendFile(path.resolve(__dirname1, "frontend", "build", "index.html"))
//   );
// } else {
//   app.get("/", (req, res) => {
//     res.send("API is running..");
//   });
// }

// --------------------------deployment------------------------------

// Error Handling middlewares
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 8000;

const server = app.listen(
  PORT,
  console.log(`Server running on PORT ${PORT}...`)
);

const io = require("socket.io")(server, {
  pingTimeout: 60000,
  cors: {
    origin: "http://localhost:3000",
    // credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log("Connected to socket.io");
  socket.on("setup", (userData) => {
    socket.join(userData._id);
    socket.emit("connected");
  });

  socket.on("join chat", (room) => {
    socket.join(room);
    console.log("User Joined Room: " + room);
  });
  socket.on("typing", (room) => socket.in(room).emit("typing"));
  socket.on("stop typing", (room) => socket.in(room).emit("stop typing"));

  socket.on("new_message", (newMessageRecieved) => {
    console.log("newMessage", newMessageRecieved);
    let chat = newMessageRecieved.chat;

    if (!chat.users) return console.log("chat.users not defined");

    chat.users.forEach((user) => {
      console.log("user-----", user);
      if (user === newMessageRecieved.sender._id) return;
      console.log("msg revive -----", user._id);
      socket.in(user).emit("message_recieved", newMessageRecieved);
      console.log("msg send");
    });
  });

  socket.off("setup", () => {
    console.log("USER DISCONNECTED");
    socket.leave(userData._id);
  });
});
