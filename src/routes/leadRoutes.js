const express = require('express');
const {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  updateLeadStatus,
  assignLead,
  deleteLead,
  convertLead
} = require('../controllers/leadController');
const {
  protect,
  accessByAdminOrManager
} = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/', protect, createLead);
router.get('/', protect, getLeads);
router.get('/:id', protect, getLeadById);
router.patch('/:id', protect, updateLead);
router.patch('/:id/status', protect, updateLeadStatus);
router.patch('/:id/assign', protect, accessByAdminOrManager, assignLead);
router.delete('/:id', protect, accessByAdminOrManager, deleteLead);
router.post('/:id/convert', protect, convertLead);

module.exports = router;
