const express = require('express');
const {
  createActivity,
  getActivities,
  getActivityById,
  updateActivity,
  completeActivity,
  deleteActivity
} = require('../controllers/activityController');
const {
  protect,
  accessByAdminOrManager
} = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/', protect, createActivity);
router.get('/', protect, getActivities);
router.get('/:id', protect, getActivityById);
router.put('/:id', protect, updateActivity);
router.patch('/:id', protect, updateActivity);
router.patch('/:id/complete', protect, completeActivity);
router.delete('/:id', protect, accessByAdminOrManager, deleteActivity);

module.exports = router;
