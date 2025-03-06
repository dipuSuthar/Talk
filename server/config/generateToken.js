const jwt = require("jsonwebtoken");
const token = process.env.JWT_SECRET;
const generateToken = (id) => {
  return jwt.sign({ id }, token, {
    expiresIn: "30d",
  });
};

module.exports = generateToken;
