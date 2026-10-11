const express = require('express');
const {
  createDeal,
  getDeals,
  getDealById,
  updateDeal,
  updateDealStage,
  deleteDeal
} = require('../controllers/dealController');
const {
  protect,
  accessByAdmin
} = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/', protect, createDeal);
router.get('/', protect, getDeals);
router.get('/:id', protect, getDealById);
router.put('/:id', protect, updateDeal);
router.patch('/:id', protect, updateDeal);
router.patch('/:id/stage', protect, updateDealStage);
router.delete('/:id', protect, accessByAdmin, deleteDeal);

module.exports = router;
