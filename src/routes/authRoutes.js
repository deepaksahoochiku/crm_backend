const express = require('express');
const {
  register,
  login,
  getMe,
  logout,
  getUsers,
  getUserById,
  updateUser,
  toggleUserStatus,
  deleteUser,
  assignManager
} = require('../controllers/authController');
const {
  protect,
  accessByAdmin,
  accessByAdminOrManager,
  verifyCreateUserPermission
} = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/create-user', verifyCreateUserPermission, register);
router.post('/login', login);
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.get('/users', protect, accessByAdminOrManager, getUsers);
router.get('/users/:id', protect, getUserById);
router.patch('/users/:id', protect, updateUser);
router.patch('/users/:id/status', protect, accessByAdminOrManager, toggleUserStatus);
router.delete('/users/:id', protect, accessByAdmin, deleteUser);
router.patch('/assign-manager', protect, accessByAdmin, assignManager);

module.exports = router;
