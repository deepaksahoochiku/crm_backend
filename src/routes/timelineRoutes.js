const express = require('express');
const {
  getEntityTimeline,
  getTimelineFeed
} = require('../controllers/timelineController');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/', protect, getTimelineFeed);
router.get('/:entityType/:entityId', protect, getEntityTimeline);

module.exports = router;
