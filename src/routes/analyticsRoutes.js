const express = require('express');
const {
  getDashboardSummary,
  getPipelineMetrics
} = require('../controllers/analyticsController');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/dashboard', getDashboardSummary);
router.get('/pipeline', getPipelineMetrics);
router.get('/', getDashboardSummary);

module.exports = router;
