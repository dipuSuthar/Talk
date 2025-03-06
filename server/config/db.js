const mongoose = require("mongoose");
const connectDB = async () => {
  console.log(process.env.MONGO_URL);
  try {
    const url = process.env.MONGO_URL;
    const conn = await mongoose.connect(url, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
