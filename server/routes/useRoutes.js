const express = require("express");
const {
  registerUser,
  authUser,
  allUsers,
  upload,
} = require("../controllers/userController");
const { protect } = require("../middelware/authMiddelware");

const router = express.Router();

router.route("/").get(protect, allUsers);
router.post("/register", upload.single("pic"), registerUser); // Apply multer here
router.post("/login", authUser);

module.exports = router;
